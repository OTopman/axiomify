import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthPlugin,
  JwksClient,
  JwksFetchError,
  signJwt,
  verifyJwt,
} from '../src/index';

const rsaA = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaB = generateKeyPairSync('rsa', { modulusLength: 2048 });
const p256 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

function jwkOf(
  key: { publicKey: import('node:crypto').KeyObject },
  kid: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(key.publicKey.export({ format: 'jwk' }) as object),
    kid,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const JWKS_URL = 'https://issuer.example.com/.well-known/jwks.json';

describe('JwksClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('requires a url', () => {
    expect(() => new JwksClient({} as any)).toThrow(/requires a `url`/);
  });

  it('fetches keys, resolves by kid, and verifies a token end-to-end', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ keys: [jwkOf(rsaA, 'kid-a'), jwkOf(p256, 'kid-ec')] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL });

    const token = signJwt(
      { sub: 'user-1' },
      {
        algorithm: 'RS256',
        privateKey: rsaA.privateKey,
        expiresIn: 60,
        keyid: 'kid-a',
      },
    );
    const claims = await verifyJwt(token, {
      algorithms: ['RS256'],
      keyResolver: client,
    });
    expect(claims.sub).toBe('user-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      JWKS_URL,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );

    // EC key resolves with EC requirement
    const ecToken = signJwt(
      { sub: 'ec' },
      {
        algorithm: 'ES256',
        privateKey: p256.privateKey,
        expiresIn: 60,
        keyid: 'kid-ec',
      },
    );
    await expect(
      verifyJwt(ecToken, { algorithms: ['ES256'], keyResolver: client }),
    ).resolves.toMatchObject({ sub: 'ec' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache
  });

  it('serves cached keys within the TTL and refetches after expiry', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL });

    await client.getKey('kid-a', 'RS256');
    vi.advanceTimersByTime(599_000);
    await client.getKey('kid-a', 'RS256');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000); // past the 10-minute TTL
    await client.getKey('kid-a', 'RS256');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('handles key rotation: unknown kid triggers a refetch after the cooldown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] }))
      .mockResolvedValueOnce(jsonResponse({ keys: [jwkOf(rsaB, 'kid-b')] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL });

    await client.getKey('kid-a', 'RS256');

    // Within the 30s cooldown an unknown kid must NOT refetch.
    vi.advanceTimersByTime(10_000);
    await expect(client.getKey('kid-b', 'RS256')).rejects.toThrow(
      /"kid-b" not found/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // After the cooldown the rotation is picked up.
    vi.advanceTimersByTime(21_000);
    const key = await client.getKey('kid-b', 'RS256');
    expect(key.type).toBe('public');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('floors the cooldown at 30 seconds even if configured lower', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL, cooldownMs: 1 });

    await client.getKey('kid-a', 'RS256');
    vi.advanceTimersByTime(5_000);
    await expect(client.getKey('kid-zzz', 'RS256')).rejects.toThrow(
      /not found/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds the number of retained keys via maxKeys', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        keys: [jwkOf(rsaA, 'k1'), jwkOf(rsaB, 'k2'), jwkOf(p256, 'k3')],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL, maxKeys: 2 });

    await client.getKey('k1', 'RS256');
    await client.getKey('k2', 'RS256');
    await expect(client.getKey('k3', 'ES256')).rejects.toThrow(/not found/);
  });

  it('discards symmetric, encryption-use and kid-less JWKs', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        keys: [
          {
            kty: 'oct',
            kid: 'evil-hmac',
            k: Buffer.from('x'.repeat(32)).toString('base64url'),
          },
          jwkOf(rsaA, 'enc-key', { use: 'enc' }),
          jwkOf(rsaB, 'no-verify', { key_ops: ['encrypt'] }),
          { ...(rsaB.publicKey.export({ format: 'jwk' }) as object) }, // no kid
          jwkOf(rsaA, 'good', { use: 'sig' }),
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL });

    await expect(client.getKey('good', 'RS256')).resolves.toBeTruthy();
    for (const kid of ['evil-hmac', 'enc-key', 'no-verify']) {
      vi.advanceTimersByTime(31_000);
      await expect(client.getKey(kid, 'RS256')).rejects.toThrow(/not found/);
    }
  });

  it('never serves keys for HS* or unknown algorithms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] })),
    );
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('kid-a', 'HS256')).rejects.toThrow(
      /only RS\*\/ES\* are supported/,
    );
    await expect(client.getKey('kid-a', 'none')).rejects.toThrow(
      /only RS\*\/ES\* are supported/,
    );
  });

  it('selects a lone compatible key when the token has no kid, but refuses ambiguity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ keys: [jwkOf(rsaA, 'kid-a'), jwkOf(p256, 'kid-ec')] }),
      ),
    );
    const client = new JwksClient({ url: JWKS_URL });
    // Exactly one RSA key and one EC key → unambiguous per family.
    await expect(client.getKey(undefined, 'RS256')).resolves.toBeTruthy();
    await expect(client.getKey(undefined, 'ES256')).resolves.toBeTruthy();

    const twoRsa = new JwksClient({ url: JWKS_URL });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ keys: [jwkOf(rsaA, 'k1'), jwkOf(rsaB, 'k2')] }),
      ),
    );
    await expect(twoRsa.getKey(undefined, 'RS256')).rejects.toThrow(
      /no single unambiguous compatible key/,
    );
  });

  it('rejects with a 503-mapped JwksFetchError on transport and format failures', async () => {
    const client = new JwksClient({ url: JWKS_URL });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 500)),
    );
    await expect(client.getKey('kid-a', 'RS256')).rejects.toBeInstanceOf(
      JwksFetchError,
    );
    await expect(client.getKey('kid-a', 'RS256')).rejects.toMatchObject({
      statusCode: 503,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    client.clearCache();
    await expect(client.getKey('kid-a', 'RS256')).rejects.toThrow(
      /JWKS fetch failed/,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      })),
    );
    client.clearCache();
    await expect(client.getKey('kid-a', 'RS256')).rejects.toThrow(
      /invalid JSON/,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ nokeys: true })),
    );
    client.clearCache();
    await expect(client.getKey('kid-a', 'RS256')).rejects.toThrow(
      /no "keys" array/,
    );
  });

  it('deduplicates concurrent refreshes into one fetch', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL });

    await Promise.all([
      client.getKey('kid-a', 'RS256'),
      client.getKey('kid-a', 'RS256'),
      client.getKey('kid-a', 'RS256'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clearCache forces a refetch', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JwksClient({ url: JWKS_URL });

    await client.getKey('kid-a', 'RS256');
    client.clearCache();
    await client.getKey('kid-a', 'RS256');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('createAuthPlugin — jwks wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockRes() {
    return {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      headersSent: false,
    } as any;
  }

  it('authenticates via jwks options and rejects rogue-key tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] })),
    );
    const plugin = createAuthPlugin({ jwks: { url: JWKS_URL } });

    const good = signJwt(
      { sub: 'jwks-user' },
      {
        algorithm: 'RS256',
        privateKey: rsaA.privateKey,
        expiresIn: 60,
        keyid: 'kid-a',
      },
    );
    const req: any = {
      headers: { authorization: `Bearer ${good}` },
      state: {},
    };
    await plugin(req, mockRes());
    expect(req.state.user.sub).toBe('jwks-user');

    // Same kid, different (attacker) private key → 401.
    const rogue = signJwt(
      { sub: 'attacker' },
      {
        algorithm: 'RS256',
        privateKey: rsaB.privateKey,
        expiresIn: 60,
        keyid: 'kid-a',
      },
    );
    const res = mockRes();
    await plugin(
      { headers: { authorization: `Bearer ${rogue}` }, state: {} } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a pre-built JwksClient instance and rejects HS* allowlists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ keys: [jwkOf(rsaA, 'kid-a')] })),
    );
    const client = new JwksClient({ url: JWKS_URL });
    const plugin = createAuthPlugin({ jwks: client, algorithms: ['RS256'] });
    const token = signJwt(
      { sub: 'x' },
      {
        algorithm: 'RS256',
        privateKey: rsaA.privateKey,
        expiresIn: 60,
        keyid: 'kid-a',
      },
    );
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      state: {},
    };
    await plugin(req, mockRes());
    expect(req.state.user.sub).toBe('x');

    expect(() =>
      createAuthPlugin({ jwks: client, algorithms: ['HS256'] }),
    ).toThrow(/algorithm-confusion defence/);
  });

  it('surfaces JWKS outages as 503, not 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 502)),
    );
    const plugin = createAuthPlugin({ jwks: { url: JWKS_URL } });
    const token = signJwt(
      { sub: 'x' },
      {
        algorithm: 'RS256',
        privateKey: rsaA.privateKey,
        expiresIn: 60,
        keyid: 'kid-a',
      },
    );
    await expect(
      plugin(
        { headers: { authorization: `Bearer ${token}` }, state: {} } as any,
        mockRes(),
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
