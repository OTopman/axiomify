import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApiKeyPlugin,
  generateApiKey,
  getApiKey,
  hashApiKeySecret,
  parseApiKey,
} from '../src/index';

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    header: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    headersSent: false,
  } as any;
}

function reqWithKey(key?: string, header = 'x-api-key') {
  return {
    headers: key ? { [header]: key } : {},
    state: {},
  } as any;
}

describe('API key primitives', () => {
  it('generateApiKey produces ax_<id>_<secret> and stores a PBKDF2 hash encoding', () => {
    const { apiKey, id, hashedKey } = generateApiKey();
    expect(apiKey).toMatch(/^ax_[0-9a-f]{16}_[A-Za-z0-9_-]+$/);
    const parsed = parseApiKey(apiKey)!;
    expect(parsed.id).toBe(id);
    expect(hashedKey).toMatch(/^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/i);
    expect(hashApiKeySecret(parsed.secret)).not.toBe(hashedKey);
  });

  it('generateApiKey accepts a custom id but rejects underscores', () => {
    expect(generateApiKey('svc1').apiKey.startsWith('ax_svc1_')).toBe(true);
    expect(() => generateApiKey('has_underscore')).toThrow(/must not contain "_"/);
  });

  it('hashApiKeySecret is deterministic', () => {
    expect(hashApiKeySecret('abc')).toBe(hashApiKeySecret('abc'));
    expect(hashApiKeySecret('abc')).not.toBe(hashApiKeySecret('abd'));
  });

  it.each([
    ['', 'empty'],
    ['not-a-key', 'no prefix'],
    ['ax_', 'no id'],
    ['ax_id', 'no separator'],
    ['ax_id_', 'empty secret'],
    ['ax__secret', 'empty id'],
    ['bx_id_secret', 'wrong prefix'],
    ['ax_' + 'a'.repeat(600), 'over max length'],
  ])('parseApiKey rejects malformed input %#: %s', (raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });

  it('parseApiKey allows underscores inside the secret part', () => {
    expect(parseApiKey('ax_id1_se_cr_et')).toEqual({
      id: 'id1',
      secret: 'se_cr_et',
    });
  });
});

describe('createApiKeyPlugin — configuration', () => {
  it('requires exactly one of keys/lookup', () => {
    expect(() => createApiKeyPlugin({} as any)).toThrow(/requires `keys` or `lookup`/);
    expect(() =>
      createApiKeyPlugin({ keys: {}, lookup: async () => null }),
    ).toThrow(/not both/);
  });

  it('rejects ids with underscores and malformed hashedKey records', () => {
    expect(() =>
      createApiKeyPlugin({ keys: { bad_id: { hashedKey: hashApiKeySecret('x') } } }),
    ).toThrow(/must not contain "_"/);
    expect(() =>
      createApiKeyPlugin({ keys: { id1: { hashedKey: 'not-hex' } } }),
    ).toThrow(/64-char hex SHA-256/);
    expect(() =>
      createApiKeyPlugin({ keys: { id1: {} as any } }),
    ).toThrow(/must include a "hashedKey"/);
  });

  it('accepts plaintext secrets but logs a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      createApiKeyPlugin({ keys: { dev: 'plaintext-secret' } });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('PLAINTEXT'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('requireApiKey — static keys', () => {
  const generated = generateApiKey('svc');
  const plugin = createApiKeyPlugin({
    keys: {
      svc: { hashedKey: generated.hashedKey, scopes: ['read', 'write'], meta: { tier: 'gold' } },
    },
  });

  it('authenticates a valid key and populates req.state (frozen user semantics)', async () => {
    const req = reqWithKey(generated.apiKey);
    const res = mockRes();
    await plugin.requireApiKey()(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.state.user).toMatchObject({ id: 'svc', authType: 'api-key' });
    expect(Object.isFrozen(req.state.user)).toBe(true);
    const info = getApiKey(req)!;
    expect(info).toMatchObject({ id: 'svc', meta: { tier: 'gold' } });
    expect([...info.scopes]).toEqual(['read', 'write']);
    expect(Object.isFrozen(info)).toBe(true);
  });

  it('uses req.state.set when the adapter provides it', async () => {
    const bag: Record<string, unknown> = {};
    const req: any = {
      headers: { 'x-api-key': generated.apiKey },
      state: { set: vi.fn((k: string, v: unknown) => (bag[k] = v)) },
    };
    await plugin.requireApiKey()(req, mockRes());
    expect(req.state.set).toHaveBeenCalledWith('user', expect.objectContaining({ id: 'svc' }));
    expect(req.state.set).toHaveBeenCalledWith('apiKey', expect.objectContaining({ id: 'svc' }));
  });

  it('401s on missing, malformed, unknown-id and wrong-secret keys with uniform messaging', async () => {
    const cases = [
      undefined,
      'garbage',
      'ax_unknown_wrongsecret',
      `ax_svc_wrongsecret`,
    ];
    for (const key of cases) {
      const res = mockRes();
      await plugin.requireApiKey()(reqWithKey(key), res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    // Unknown id and wrong secret are indistinguishable to the caller.
    const resUnknown = mockRes();
    await plugin.requireApiKey()(reqWithKey('ax_nobody_x1234'), resUnknown);
    const resWrong = mockRes();
    await plugin.requireApiKey()(reqWithKey('ax_svc_x1234'), resWrong);
    expect(resUnknown.send.mock.calls[0][1]).toBe(resWrong.send.mock.calls[0][1]);
  });

  it('enforces scopes: 403 when missing, 200-path when granted', async () => {
    const ok = mockRes();
    await plugin.requireApiKey(['read'])(reqWithKey(generated.apiKey), ok);
    expect(ok.status).not.toHaveBeenCalled();

    const forbidden = mockRes();
    await plugin.requireApiKey(['admin'])(reqWithKey(generated.apiKey), forbidden);
    expect(forbidden.status).toHaveBeenCalledWith(403);
    expect(forbidden.send).toHaveBeenCalledWith(
      null,
      expect.stringContaining('admin'),
    );
  });

  it('applies plugin-level default scopes and per-route overrides', async () => {
    const strict = createApiKeyPlugin({
      keys: { svc: { hashedKey: generated.hashedKey, scopes: ['read'] } },
      scopes: ['admin'],
    });
    const denied = mockRes();
    await strict.requireApiKey()(reqWithKey(generated.apiKey), denied);
    expect(denied.status).toHaveBeenCalledWith(403);

    const allowed = mockRes();
    await strict.requireApiKey(['read'])(reqWithKey(generated.apiKey), allowed);
    expect(allowed.status).not.toHaveBeenCalled();
  });

  it('reads the key from a custom header', async () => {
    const custom = createApiKeyPlugin({
      keys: { svc: { hashedKey: generated.hashedKey } },
      header: 'X-Service-Key',
    });
    const req = reqWithKey(generated.apiKey, 'x-service-key');
    const res = mockRes();
    await custom.requireApiKey()(req, res);
    expect(res.status).not.toHaveBeenCalled();

    const missing = mockRes();
    await custom.requireApiKey()(reqWithKey(generated.apiKey), missing);
    expect(missing.status).toHaveBeenCalledWith(401);
  });
});

describe('requireApiKey — async lookup', () => {
  const generated = generateApiKey('db1');

  it('resolves records through the lookup and rejects unknown ids', async () => {
    const lookup = vi.fn(async (id: string) =>
      id === 'db1'
        ? { hashedKey: generated.hashedKey, scopes: ['read'], meta: { org: 42 } }
        : null,
    );
    const plugin = createApiKeyPlugin({ lookup });

    const req = reqWithKey(generated.apiKey);
    const res = mockRes();
    await plugin.requireApiKey(['read'])(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith('db1');
    expect(getApiKey(req)).toMatchObject({ id: 'db1', meta: { org: 42 } });

    const unknown = mockRes();
    await plugin.requireApiKey()(reqWithKey('ax_ghost_secret1'), unknown);
    expect(unknown.status).toHaveBeenCalledWith(401);
  });

  it('maps lookup failures to 503 (infrastructure), never 401', async () => {
    const plugin = createApiKeyPlugin({
      lookup: async () => {
        throw new Error('db down');
      },
    });
    await expect(
      plugin.requireApiKey()(reqWithKey(generated.apiKey), mockRes()),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('a record with a malformed hashedKey can never authenticate', async () => {
    const plugin = createApiKeyPlugin({
      lookup: async () => ({ hashedKey: 'corrupted' }),
    });
    const res = mockRes();
    await plugin.requireApiKey()(reqWithKey(generated.apiKey), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
