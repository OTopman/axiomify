import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApiKeyPlugin,
  generateApiKey,
  getApiKey,
  hashApiKeySecret,
  hashApiKeySecretPbkdf2,
  parseApiKey,
} from '../src/index';

const makeRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  }) as any;

const makeReq = (key?: string, state: any = {}, header = 'x-api-key') =>
  ({
    headers: key === undefined ? {} : { [header]: key },
    state,
  }) as any;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseApiKey / generateApiKey / hashApiKeySecret', () => {
  it('parses the ax_<id>_<secret> format', () => {
    expect(parseApiKey('ax_myid_s3cret')).toEqual({
      id: 'myid',
      secret: 's3cret',
    });
  });

  it('keeps underscores inside the secret part', () => {
    expect(parseApiKey('ax_myid_se_cr_et')).toEqual({
      id: 'myid',
      secret: 'se_cr_et',
    });
  });

  it.each([
    ['wrong prefix', 'sk_myid_secret'],
    ['no separator after id', 'ax_myid'],
    ['empty secret', 'ax_myid_'],
    ['empty id', 'ax__secret'],
    ['empty string', ''],
    ['prefix only', 'ax_'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });

  it('returns null for oversized keys', () => {
    expect(parseApiKey(`ax_id_${'a'.repeat(600)}`)).toBeNull();
  });

  it('generateApiKey returns a parseable key whose hash matches the secret', () => {
    const { apiKey, id, hashedKey } = generateApiKey();
    const parsed = parseApiKey(apiKey)!;
    expect(parsed.id).toBe(id);
    expect(hashedKey).toBe(hashApiKeySecret(parsed.secret));
    expect(hashedKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateApiKey honours a custom id and rejects ids with underscores', () => {
    expect(generateApiKey('svc1').id).toBe('svc1');
    expect(() => generateApiKey('bad_id')).toThrow(/must not contain "_"/);
  });

  it('hashApiKeySecret is a deterministic sha256 hex digest', () => {
    expect(hashApiKeySecret('abc')).toBe(hashApiKeySecret('abc'));
    expect(hashApiKeySecret('abc')).toHaveLength(64);
    expect(hashApiKeySecret('abc')).not.toBe(hashApiKeySecret('abd'));
  });

  it('hashApiKeySecretPbkdf2 generates valid pbkdf2 format string and authenticates', () => {
    const pbkdf2Hash = hashApiKeySecretPbkdf2('mysecret');
    expect(pbkdf2Hash).toMatch(/^pbkdf2:sha256:\d+:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(hashApiKeySecretPbkdf2('mysecret')).toBe(pbkdf2Hash);
  });
});

describe('createApiKeyPlugin — static keys map', () => {
  const { apiKey, hashedKey } = generateApiKey('svc1');
  const plugin = createApiKeyPlugin({
    keys: {
      svc1: { hashedKey, scopes: ['read'], meta: { owner: 'ops' } },
    },
  });

  it('authenticates a valid key and populates req.state', async () => {
    const req = makeReq(apiKey);
    const res = makeRes();
    await plugin.requireApiKey()(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(req.state.user).toMatchObject({ id: 'svc1', authType: 'api-key' });
    expect(getApiKey(req)).toMatchObject({
      id: 'svc1',
      scopes: ['read'],
      meta: { owner: 'ops' },
    });
  });

  it('uses req.state.set when the request state supports it', async () => {
    const set = vi.fn();
    const req = makeReq(apiKey, { set });
    await plugin.requireApiKey()(req, makeRes());

    expect(set).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ id: 'svc1', authType: 'api-key' }),
    );
    expect(set).toHaveBeenCalledWith(
      'apiKey',
      expect.objectContaining({ id: 'svc1' }),
    );
  });

  it('rejects a wrong secret for a known id with 401', async () => {
    const res = makeRes();
    await plugin.requireApiKey()(makeReq('ax_svc1_wrong-secret'), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(null, expect.stringMatching(/Invalid/));
  });

  it('rejects an unknown id with 401', async () => {
    const res = makeRes();
    await plugin.requireApiKey()(makeReq('ax_ghost_whatever'), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a missing header with 401', async () => {
    const res = makeRes();
    await plugin.requireApiKey()(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(null, expect.stringMatching(/Missing/));
  });

  it('rejects a malformed key with 401', async () => {
    const res = makeRes();
    await plugin.requireApiKey()(makeReq('not-an-api-key'), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/Malformed/),
    );
  });

  it('accepts the header as an array (first value wins)', async () => {
    const req = { headers: { 'x-api-key': [apiKey] }, state: {} } as any;
    const res = makeRes();
    await plugin.requireApiKey()(req, res);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('supports a custom header name', async () => {
    const custom = createApiKeyPlugin({
      keys: { svc1: { hashedKey } },
      header: 'X-Service-Key',
    });
    const res = makeRes();
    await custom.requireApiKey()(makeReq(apiKey, {}, 'x-service-key'), res);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('createApiKeyPlugin — scope enforcement', () => {
  const { apiKey, hashedKey } = generateApiKey('scoped');
  const plugin = createApiKeyPlugin({
    keys: { scoped: { hashedKey, scopes: ['read', 'write'] } },
  });

  it('passes when every required scope is granted', async () => {
    const res = makeRes();
    await plugin.requireApiKey(['read', 'write'])(makeReq(apiKey), res);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 403 and lists the missing scopes', async () => {
    const res = makeRes();
    await plugin.requireApiKey(['read', 'admin', 'billing'])(
      makeReq(apiKey),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/admin, billing/),
    );
  });

  it('applies plugin-level default scopes to requireApiKey()', async () => {
    const strict = createApiKeyPlugin({
      keys: { scoped: { hashedKey, scopes: ['read'] } },
      scopes: ['admin'],
    });
    const res = makeRes();
    await strict.requireApiKey()(makeReq(apiKey), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('treats a key without scopes as having none', async () => {
    const bare = createApiKeyPlugin({ keys: { scoped: { hashedKey } } });
    const res = makeRes();
    await bare.requireApiKey(['read'])(makeReq(apiKey), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('createApiKeyPlugin — async lookup', () => {
  const { apiKey, hashedKey } = generateApiKey('dbkey');

  it('authenticates via the lookup function', async () => {
    const lookup = vi.fn(async (id: string) =>
      id === 'dbkey' ? { hashedKey, scopes: ['read'] } : null,
    );
    const plugin = createApiKeyPlugin({ lookup });
    const req = makeReq(apiKey);
    const res = makeRes();
    await plugin.requireApiKey()(req, res);

    expect(lookup).toHaveBeenCalledWith('dbkey');
    expect(res.status).not.toHaveBeenCalled();
    expect(req.state.user.id).toBe('dbkey');
  });

  it('rejects with 401 when lookup returns null', async () => {
    const plugin = createApiKeyPlugin({ lookup: async () => null });
    const res = makeRes();
    await plugin.requireApiKey()(makeReq(apiKey), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('surfaces lookup errors as 503, never 401', async () => {
    const plugin = createApiKeyPlugin({
      lookup: async () => {
        throw new Error('db down');
      },
    });
    const err = await plugin
      .requireApiKey()(makeReq(apiKey), makeRes())
      .catch((e: unknown) => e);
    expect((err as any).statusCode).toBe(503);
  });
});

describe('createApiKeyPlugin — configuration validation', () => {
  const { hashedKey } = generateApiKey('cfg');

  it('requires exactly one of keys/lookup', () => {
    expect(() => createApiKeyPlugin({} as never)).toThrow(
      /requires `keys` or `lookup`/,
    );
    expect(() =>
      createApiKeyPlugin({ keys: {}, lookup: async () => null }),
    ).toThrow(/not both/);
  });

  it('rejects records without a valid hashedKey', () => {
    expect(() =>
      createApiKeyPlugin({ keys: { cfg: {} as never } }),
    ).toThrow(/must include a "hashedKey"/);
    expect(() =>
      createApiKeyPlugin({ keys: { cfg: { hashedKey: 'not-hex' } } }),
    ).toThrow(/64-char hex/);
  });

  it('rejects static key ids containing "_"', () => {
    expect(() =>
      createApiKeyPlugin({ keys: { bad_id: { hashedKey } } }),
    ).toThrow(/must not contain "_"/);
  });

  it('warns about plaintext secrets but still authenticates them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = createApiKeyPlugin({ keys: { dev: 'plain-dev-secret' } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/PLAINTEXT/));

    const req = makeReq('ax_dev_plain-dev-secret');
    const res = makeRes();
    await plugin.requireApiKey()(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.state.user.id).toBe('dev');
  });

  it('does not warn when only hashed keys are provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createApiKeyPlugin({ keys: { cfg: { hashedKey } } });
    expect(warn).not.toHaveBeenCalled();
  });
});
