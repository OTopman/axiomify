import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwksClient, JwksFetchError, signJwt, verifyJwt } from '../src/index';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const rsaJwk = {
  ...(rsa.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'rsa-1',
  use: 'sig',
};
const ecJwk = {
  ...(ec.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'ec-1',
  use: 'sig',
};

const JWKS_URL = 'https://issuer.example.com/.well-known/jwks.json';

function jwksResponse(keys: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ keys }) };
}

function stubFetch(impl: (...args: unknown[]) => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('JwksClient — key resolution and verification round-trips', () => {
  it('verifies an RS256 token via a JWK served from the mocked JWKS', async () => {
    const fetchMock = stubFetch(async () => jwksResponse([rsaJwk, ecJwk]));
    const client = new JwksClient({ url: JWKS_URL });

    const token = signJwt(
      { sub: 'user-1' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, keyid: 'rsa-1' },
    );
    const payload = await verifyJwt(token, {
      algorithms: ['RS256'],
      keyResolver: client,
    });
    expect(payload.sub).toBe('user-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(JWKS_URL);
  });

  it('verifies an ES256 token via an EC JWK', async () => {
    stubFetch(async () => jwksResponse([rsaJwk, ecJwk]));
    const client = new JwksClient({ url: JWKS_URL });

    const token = signJwt(
      { sub: 'ec-user' },
      { algorithm: 'ES256', privateKey: ec.privateKey, keyid: 'ec-1' },
    );
    const payload = await verifyJwt(token, {
      algorithms: ['ES256'],
      keyResolver: client,
    });
    expect(payload.sub).toBe('ec-user');
  });

  it('resolves a token without kid when exactly one compatible key exists', async () => {
    stubFetch(async () => jwksResponse([rsaJwk, ecJwk]));
    const client = new JwksClient({ url: JWKS_URL });

    // One RSA + one EC key: RS256 without kid is still unambiguous.
    const token = signJwt(
      { sub: 'no-kid' },
      { algorithm: 'RS256', privateKey: rsa.privateKey },
    );
    const payload = await verifyJwt(token, {
      algorithms: ['RS256'],
      keyResolver: client,
    });
    expect(payload.sub).toBe('no-kid');
  });

  it('rejects a token without kid when key selection would be ambiguous', async () => {
    stubFetch(async () =>
      jwksResponse([rsaJwk, { ...rsaJwk, kid: 'rsa-other' }]),
    );
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey(undefined, 'RS256')).rejects.toThrow(
      /no single unambiguous compatible key/,
    );
  });

  it('rejects a kid whose key does not match the algorithm family', async () => {
    stubFetch(async () => jwksResponse([rsaJwk, ecJwk]));
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('ec-1', 'RS256')).rejects.toThrow(/not found/);
  });
});

describe('JwksClient — cache TTL and unknown-kid cooldown', () => {
  it('serves from cache within the TTL and refetches after expiry', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(async () => jwksResponse([rsaJwk]));
    const client = new JwksClient({ url: JWKS_URL, cacheTtlMs: 60_000 });

    await client.getKey('rsa-1', 'RS256');
    await client.getKey('rsa-1', 'RS256');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await client.getKey('rsa-1', 'RS256');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches on unknown kid after the cooldown, but not within it', async () => {
    vi.useFakeTimers();
    let served: unknown[] = [rsaJwk];
    const fetchMock = stubFetch(async () => jwksResponse(served));
    const client = new JwksClient({ url: JWKS_URL });

    await client.getKey('rsa-1', 'RS256'); // initial fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Unknown kid immediately after a fetch: inside the 30 s cooldown, so a
    // forged kid must NOT trigger another JWKS request.
    await expect(client.getKey('rsa-2', 'RS256')).rejects.toThrow(/not found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Key rotation: after the cooldown an unknown kid refetches and resolves.
    vi.advanceTimersByTime(30_001);
    served = [rsaJwk, { ...rsaJwk, kid: 'rsa-2' }];
    const key = await client.getKey('rsa-2', 'RS256');
    expect(key.type).toBe('public');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A second unknown kid within the new cooldown must NOT refetch.
    await expect(client.getKey('rsa-3', 'RS256')).rejects.toThrow(/not found/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clearCache forces a refetch on the next getKey', async () => {
    const fetchMock = stubFetch(async () => jwksResponse([rsaJwk]));
    const client = new JwksClient({ url: JWKS_URL });

    await client.getKey('rsa-1', 'RS256');
    client.clearCache();
    await client.getKey('rsa-1', 'RS256');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('JwksClient — key-set hygiene', () => {
  it('retains at most maxKeys keys from the document', async () => {
    stubFetch(async () =>
      jwksResponse([
        { ...rsaJwk, kid: 'k1' },
        { ...rsaJwk, kid: 'k2' },
        { ...rsaJwk, kid: 'k3' },
      ]),
    );
    const client = new JwksClient({ url: JWKS_URL, maxKeys: 2 });

    await expect(client.getKey('k1', 'RS256')).resolves.toBeDefined();
    await expect(client.getKey('k2', 'RS256')).resolves.toBeDefined();
    // Third key was dropped by the maxKeys bound (and the unknown-kid
    // refetch is suppressed by the cooldown).
    await expect(client.getKey('k3', 'RS256')).rejects.toThrow(/not found/);
  });

  it('refuses to serve keys for HS* algorithms', async () => {
    stubFetch(async () => jwksResponse([rsaJwk]));
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('rsa-1', 'HS256')).rejects.toThrow(
      /only RS\*\/ES\* are supported/,
    );
  });

  it('discards symmetric (oct) JWKs so a hostile JWKS cannot enable HS*', async () => {
    stubFetch(async () =>
      jwksResponse([
        {
          kty: 'oct',
          k: Buffer.from('secret').toString('base64url'),
          kid: 'sym-1',
        },
      ]),
    );
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('sym-1', 'RS256')).rejects.toThrow(/not found/);
  });

  it('skips non-sig, non-verify and kid-less JWK entries', async () => {
    stubFetch(async () =>
      jwksResponse([
        { ...rsaJwk, kid: 'enc-key', use: 'enc' },
        { ...rsaJwk, kid: 'no-verify', use: 'sig', key_ops: ['encrypt'] },
        { ...rsaJwk, kid: undefined },
        rsaJwk,
      ]),
    );
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('rsa-1', 'RS256')).resolves.toBeDefined();
    await expect(client.getKey('enc-key', 'RS256')).rejects.toThrow(
      /not found/,
    );
    await expect(client.getKey('no-verify', 'RS256')).rejects.toThrow(
      /not found/,
    );
  });
});

describe('JwksClient — fetch failure handling', () => {
  it('wraps network errors in JwksFetchError (statusCode 503)', async () => {
    stubFetch(async () => {
      throw new Error('connection refused');
    });
    const client = new JwksClient({ url: JWKS_URL });
    const err = await client.getKey('rsa-1', 'RS256').catch((e) => e);
    expect(err).toBeInstanceOf(JwksFetchError);
    expect(err.statusCode).toBe(503);
    expect(err.message).toMatch(/connection refused/);
  });

  it('rejects non-2xx responses', async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('rsa-1', 'RS256')).rejects.toThrow(
      /responded 500/,
    );
  });

  it('rejects invalid JSON bodies', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('rsa-1', 'RS256')).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it('rejects documents without a "keys" array', async () => {
    stubFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const client = new JwksClient({ url: JWKS_URL });
    await expect(client.getKey('rsa-1', 'RS256')).rejects.toThrow(
      /no "keys" array/,
    );
  });

  it('requires a url at construction', () => {
    expect(() => new JwksClient({} as never)).toThrow(/requires a `url`/);
  });
});
