import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeJwt,
  JwtError,
  signJwt,
  validateAlgorithmAllowlist,
  verifyJwt,
} from '../src/index';

// Test keypairs — generated once per run.
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaOther = generateKeyPairSync('rsa', { modulusLength: 2048 });
const p256 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });

const hsSecret = 'hs256-secret-that-is-at-least-32-bytes-long!!';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('signJwt/verifyJwt — RS*/ES* round-trips', () => {
  it.each(['RS256', 'RS384', 'RS512'] as const)(
    '%s signs and verifies with an RSA keypair',
    async (algorithm) => {
      const token = signJwt(
        { sub: 'user-1', role: 'admin' },
        { algorithm, privateKey: rsa.privateKey },
      );
      const payload = await verifyJwt(token, {
        algorithms: [algorithm],
        publicKey: rsa.publicKey,
      });
      expect(payload.sub).toBe('user-1');
      expect(payload.role).toBe('admin');
      expect(typeof payload.iat).toBe('number');
      expect(decodeJwt(token).header.alg).toBe(algorithm);
    },
  );

  it('ES256 signs and verifies with a P-256 keypair', async () => {
    const token = signJwt(
      { sub: 'ec-user' },
      { algorithm: 'ES256', privateKey: p256.privateKey },
    );
    const payload = await verifyJwt(token, {
      algorithms: ['ES256'],
      publicKey: p256.publicKey,
    });
    expect(payload.sub).toBe('ec-user');
  });

  it('ES384 signs and verifies with a P-384 keypair', async () => {
    const token = signJwt(
      { sub: 'ec-user' },
      { algorithm: 'ES384', privateKey: p384.privateKey },
    );
    const payload = await verifyJwt(token, {
      algorithms: ['ES384'],
      publicKey: p384.publicKey,
    });
    expect(payload.sub).toBe('ec-user');
  });

  it('accepts PEM strings for both signing and verification', async () => {
    const privatePem = rsa.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const publicPem = rsa.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const token = signJwt(
      { sub: 'pem' },
      { algorithm: 'RS256', privateKey: privatePem },
    );
    const payload = await verifyJwt(token, {
      algorithms: ['RS256'],
      publicKey: publicPem,
    });
    expect(payload.sub).toBe('pem');
  });

  it('sets standard claims and the kid header from options', () => {
    const token = signJwt(
      { sub: 'x' },
      {
        algorithm: 'RS256',
        privateKey: rsa.privateKey,
        issuer: 'https://issuer',
        audience: 'api',
        jwtid: 'jti-1',
        keyid: 'key-1',
        expiresIn: 60,
      },
    );
    const { header, payload } = decodeJwt(token);
    expect(header.kid).toBe('key-1');
    expect(payload.iss).toBe('https://issuer');
    expect(payload.aud).toBe('api');
    expect(payload.jti).toBe('jti-1');
    expect(payload.exp).toBe((payload.iat as number) + 60);
  });

  it('rejects verification with a different public key', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey },
    );
    await expect(
      verifyJwt(token, { algorithms: ['RS256'], publicKey: rsaOther.publicKey }),
    ).rejects.toThrow(/signature verification failed/);
  });

  it('refuses to sign with a public PEM', () => {
    const publicPem = rsa.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    expect(() =>
      signJwt({ sub: 'x' }, { algorithm: 'RS256', privateKey: publicPem }),
    ).toThrow(/requires a private key/);
  });

  it('rejects ES256 with a P-384 key (curve mismatch) in both directions', async () => {
    expect(() =>
      signJwt({ sub: 'x' }, { algorithm: 'ES256', privateKey: p384.privateKey }),
    ).toThrow(/Curve mismatch/);

    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'ES256', privateKey: p256.privateKey },
    );
    await expect(
      verifyJwt(token, { algorithms: ['ES256'], publicKey: p384.publicKey }),
    ).rejects.toThrow(/Curve mismatch/);
  });

  it('rejects RS256 with an EC key (key type mismatch)', () => {
    expect(() =>
      signJwt({ sub: 'x' }, { algorithm: 'RS256', privateKey: p256.privateKey }),
    ).toThrow(/requires an RSA key/);
  });
});

describe('verifyJwt — algorithm-confusion defences', () => {
  const hsToken = signJwt(
    { sub: 'x' },
    { algorithm: 'HS256', secret: hsSecret },
  );
  const rsToken = signJwt(
    { sub: 'x' },
    { algorithm: 'RS256', privateKey: rsa.privateKey },
  );

  it('rejects an HS256 token against an RS256 public-key config', async () => {
    await expect(
      verifyJwt(hsToken, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
    ).rejects.toThrow(/not in the allowlist/);
  });

  it('rejects an RS256 token against an HS256 secret config', async () => {
    await expect(
      verifyJwt(rsToken, { algorithms: ['HS256'], secret: hsSecret }),
    ).rejects.toThrow(/not in the allowlist/);
  });

  it('refuses to allowlist HS* alongside a public key', async () => {
    await expect(
      verifyJwt(rsToken, {
        algorithms: ['RS256', 'HS256'],
        publicKey: rsa.publicKey,
      }),
    ).rejects.toThrow(/HS\* algorithms cannot be allowlisted/);
  });

  it('refuses to allowlist RS*/ES* alongside a symmetric secret', async () => {
    await expect(
      verifyJwt(hsToken, { algorithms: ['HS256', 'RS256'], secret: hsSecret }),
    ).rejects.toThrow(/RS\*\/ES\* algorithms cannot be allowlisted/);
  });

  it('blocks the classic public-PEM-as-HMAC-secret attack at the key level', async () => {
    const publicPem = rsa.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    // Attacker signs an HS256 token using the server's public PEM as the
    // HMAC secret — key material typed as public must never do HMAC.
    const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'evil' })}.AAAA`;
    await expect(
      verifyJwt(forged, { algorithms: ['HS256'], secret: publicPem }),
    ).rejects.toThrow(/Algorithm confusion blocked/);
  });
});

describe('verifyJwt — alg:none and allowlist validation', () => {
  it.each(['none', 'None', 'NONE', 'nOnE'])(
    'rejects unsigned tokens with alg "%s"',
    async (alg) => {
      const token = `${b64({ alg, typ: 'JWT' })}.${b64({ sub: 'x' })}.sig`;
      await expect(
        verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
      ).rejects.toThrow(/unsigned \("none"\) tokens are forbidden/);
    },
  );

  it('rejects tokens with a missing/non-string alg header', async () => {
    const token = `${b64({ typ: 'JWT' })}.${b64({ sub: 'x' })}.sig`;
    await expect(
      verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
    ).rejects.toThrow(JwtError);
  });

  it('never allows "none" in an allowlist, in any casing', () => {
    expect(() => validateAlgorithmAllowlist(['none'])).toThrow(/not permitted/);
    expect(() => validateAlgorithmAllowlist(['RS256', 'NONE'])).toThrow(
      /not permitted/,
    );
  });

  it('rejects empty and unsupported allowlists', () => {
    expect(() => validateAlgorithmAllowlist([])).toThrow(/non-empty/);
    expect(() => validateAlgorithmAllowlist(['PS256'])).toThrow(/Unsupported/);
  });

  it('requires exactly one of secret/publicKey/keyResolver', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey },
    );
    await expect(verifyJwt(token, { algorithms: ['RS256'] })).rejects.toThrow(
      /exactly one of/,
    );
    await expect(
      verifyJwt(token, {
        algorithms: ['RS256'],
        publicKey: rsa.publicKey,
        keyResolver: { getKey: async () => rsa.publicKey },
      }),
    ).rejects.toThrow(/exactly one of/);
  });

  it('enforces the RFC 7518 32-byte minimum for HS* secrets', () => {
    expect(() =>
      signJwt({ sub: 'x' }, { algorithm: 'HS256', secret: 'short' }),
    ).toThrow(/at least 32 bytes/);
  });
});

describe('verifyJwt — exp/nbf/iat and clockTolerance matrix', () => {
  // Fixed epoch seconds so the matrix is deterministic (via currentDate).
  const NBF = 999_000;
  const EXP = 1_000_000;
  const token = signJwt(
    { sub: 'x', nbf: NBF, exp: EXP, iat: NBF },
    { algorithm: 'RS256', privateKey: rsa.privateKey, noTimestamp: true },
  );
  const at = (seconds: number, extra: Record<string, unknown> = {}) =>
    verifyJwt(token, {
      algorithms: ['RS256'],
      publicKey: rsa.publicKey,
      currentDate: new Date(seconds * 1000),
      ...extra,
    });

  it('accepts a token inside its validity window', async () => {
    await expect(at(999_500)).resolves.toMatchObject({ sub: 'x' });
  });

  it('rejects with TokenExpiredError at/after exp', async () => {
    const err = await at(EXP).catch((e) => e);
    expect(err.name).toBe('TokenExpiredError');
    expect(err.expiredAt).toEqual(new Date(EXP * 1000));
  });

  it('clockTolerance extends exp by exactly the leeway', async () => {
    await expect(at(EXP + 4, { clockTolerance: 5 })).resolves.toBeDefined();
    await expect(at(EXP + 5, { clockTolerance: 5 })).rejects.toThrow(
      /expired/,
    );
  });

  it('rejects with NotBeforeError before nbf', async () => {
    const err = await at(NBF - 10).catch((e) => e);
    expect(err.name).toBe('NotBeforeError');
    expect(err.date).toEqual(new Date(NBF * 1000));
  });

  it('clockTolerance extends nbf by exactly the leeway', async () => {
    await expect(at(NBF - 10, { clockTolerance: 15 })).resolves.toBeDefined();
    await expect(at(NBF - 16, { clockTolerance: 15 })).rejects.toThrow(
      /not active yet/,
    );
  });

  it('enforces maxTokenAge against iat', async () => {
    await expect(at(NBF + 50, { maxTokenAge: 100 })).resolves.toBeDefined();
    await expect(at(NBF + 200, { maxTokenAge: 100 })).rejects.toThrow(
      /older than maxTokenAge/,
    );
  });

  it('maxTokenAge requires an iat claim and rejects future iat', async () => {
    const noIat = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, noTimestamp: true },
    );
    await expect(
      verifyJwt(noIat, {
        algorithms: ['RS256'],
        publicKey: rsa.publicKey,
        maxTokenAge: 100,
      }),
    ).rejects.toThrow(/missing "iat"/);

    const futureIat = signJwt(
      { sub: 'x', iat: EXP },
      { algorithm: 'RS256', privateKey: rsa.privateKey, noTimestamp: true },
    );
    await expect(
      verifyJwt(futureIat, {
        algorithms: ['RS256'],
        publicKey: rsa.publicKey,
        maxTokenAge: 10_000,
        currentDate: new Date(NBF * 1000),
      }),
    ).rejects.toThrow(/"iat" claim is in the future/);
  });

  it('rejects non-numeric temporal claims', async () => {
    const bad = signJwt(
      { sub: 'x', exp: 'soon' },
      { algorithm: 'RS256', privateKey: rsa.privateKey },
    );
    await expect(
      verifyJwt(bad, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
    ).rejects.toThrow(/"exp" claim must be a number/);
  });
});

describe('verifyJwt — iss/aud validation', () => {
  const make = (claims: Record<string, unknown>) =>
    signJwt(claims, { algorithm: 'RS256', privateKey: rsa.privateKey });
  const check = (token: string, extra: Record<string, unknown>) =>
    verifyJwt(token, {
      algorithms: ['RS256'],
      publicKey: rsa.publicKey,
      ...extra,
    });

  it('validates issuer as exact string or one-of array', async () => {
    const token = make({ sub: 'x', iss: 'https://a' });
    await expect(check(token, { issuer: 'https://a' })).resolves.toBeDefined();
    await expect(
      check(token, { issuer: ['https://b', 'https://a'] }),
    ).resolves.toBeDefined();
    await expect(check(token, { issuer: 'https://b' })).rejects.toThrow(
      /"iss" claim mismatch/,
    );
  });

  it('rejects when the expected issuer is missing from the token', async () => {
    const token = make({ sub: 'x' });
    await expect(check(token, { issuer: 'https://a' })).rejects.toThrow(
      /"iss" claim mismatch/,
    );
  });

  it('validates audience with intersection semantics', async () => {
    const single = make({ sub: 'x', aud: 'api' });
    await expect(check(single, { audience: 'api' })).resolves.toBeDefined();
    await expect(
      check(single, { audience: ['web', 'api'] }),
    ).resolves.toBeDefined();

    const multi = make({ sub: 'x', aud: ['a', 'b'] });
    await expect(check(multi, { audience: 'b' })).resolves.toBeDefined();
    await expect(check(multi, { audience: 'c' })).rejects.toThrow(
      /"aud" claim mismatch/,
    );
  });

  it('rejects when the token has no aud but one is expected', async () => {
    const token = make({ sub: 'x' });
    await expect(check(token, { audience: 'api' })).rejects.toThrow(
      /"aud" claim mismatch/,
    );
  });
});

describe('verifyJwt/decodeJwt — malformed token shapes', () => {
  const verify = (token: string) =>
    verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa.publicKey });

  it('rejects wrong segment counts', async () => {
    await expect(verify('a.b')).rejects.toThrow(/three dot-separated/);
    await expect(verify('a.b.c.d')).rejects.toThrow(/three dot-separated/);
    await expect(verify('..')).rejects.toThrow(/three dot-separated/);
    await expect(verify('')).rejects.toThrow(/non-empty string/);
  });

  it('rejects segments that are not valid base64url', async () => {
    await expect(verify('not!valid.payload.sig')).rejects.toThrow(
      /not valid base64url/,
    );
  });

  it('rejects segments that decode to invalid JSON or non-objects', () => {
    const notJson = Buffer.from('hello').toString('base64url');
    expect(() => decodeJwt(`${notJson}.${notJson}.sig`)).toThrow(
      /not valid JSON/,
    );
    expect(() => decodeJwt(`${b64({ alg: 'RS256' })}.${b64([1, 2])}.sig`)).toThrow(
      /must be a JSON object/,
    );
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const token = signJwt(
      { sub: 'honest' },
      { algorithm: 'RS256', privateKey: rsa.privateKey },
    );
    const [header, , signature] = token.split('.');
    const tampered = `${header}.${b64({ sub: 'evil' })}.${signature}`;
    await expect(verify(tampered)).rejects.toThrow(
      /signature verification failed/,
    );
  });

  it('rejects a tampered signature', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'ES256', privateKey: p256.privateKey },
    );
    const [header, payload, signature] = token.split('.');
    // Flip a bit in the DECODED signature bytes: mutating the final base64url
    // character is not enough, because its low-order bits are discarded by
    // the decoder and the signature can come back unchanged.
    const sig = Buffer.from(signature, 'base64url');
    sig[10] ^= 0x01;
    const flipped = sig.toString('base64url');
    await expect(
      verifyJwt(`${header}.${payload}.${flipped}`, {
        algorithms: ['ES256'],
        publicKey: p256.publicKey,
      }),
    ).rejects.toThrow(/signature verification failed/);
  });

  it('decodeJwt decodes without verifying (and must never be trusted)', () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, keyid: 'kid-9' },
    );
    const { header, payload } = decodeJwt(token);
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'kid-9' });
    expect(payload.sub).toBe('x');
  });
});
