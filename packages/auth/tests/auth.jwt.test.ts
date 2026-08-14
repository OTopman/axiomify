import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthPlugin,
  decodeJwt,
  MemoryTokenStore,
  signJwt,
  SUPPORTED_JWT_ALGORITHMS,
  validateAlgorithmAllowlist,
  verifyJwt,
  type JwtAlgorithm,
} from '../src/index';

const HS_SECRET = 'a-very-long-secret-for-testing-purposes-only-12345';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsa2 = generateKeyPairSync('rsa', { modulusLength: 2048 });
const p256 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });

const rsaPrivPem = rsa.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const rsaPubPem = rsa.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    header: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    headersSent: false,
  } as any;
}

describe('signJwt / verifyJwt round-trips', () => {
  it.each(['HS256', 'HS384', 'HS512'] as JwtAlgorithm[])(
    '%s round-trips with a shared secret',
    async (algorithm) => {
      const token = signJwt(
        { sub: 'user-1', role: 'admin' },
        { algorithm, secret: HS_SECRET, expiresIn: 60 },
      );
      const claims = await verifyJwt(token, {
        algorithms: [algorithm],
        secret: HS_SECRET,
      });
      expect(claims.sub).toBe('user-1');
      expect(claims.role).toBe('admin');
      expect(typeof claims.iat).toBe('number');
      expect(typeof claims.exp).toBe('number');
    },
  );

  it.each(['RS256', 'RS384', 'RS512'] as JwtAlgorithm[])(
    '%s round-trips with an RSA key pair',
    async (algorithm) => {
      const token = signJwt(
        { sub: 'user-2' },
        { algorithm, privateKey: rsa.privateKey, expiresIn: 60 },
      );
      const claims = await verifyJwt(token, {
        algorithms: [algorithm],
        publicKey: rsa.publicKey,
      });
      expect(claims.sub).toBe('user-2');
    },
  );

  it('RS256 accepts PEM strings for both signing and verification', async () => {
    const token = signJwt(
      { sub: 'pem-user' },
      { algorithm: 'RS256', privateKey: rsaPrivPem, expiresIn: 60 },
    );
    const claims = await verifyJwt(token, {
      algorithms: ['RS256'],
      publicKey: rsaPubPem,
    });
    expect(claims.sub).toBe('pem-user');
  });

  it('ES256 round-trips and produces a raw 64-byte (r||s) signature', async () => {
    const token = signJwt(
      { sub: 'ec-user' },
      { algorithm: 'ES256', privateKey: p256.privateKey, expiresIn: 60 },
    );
    // JOSE ES256 signatures are raw r||s (2 × 32 bytes), never ASN.1/DER.
    const sig = Buffer.from(token.split('.')[2], 'base64url');
    expect(sig.length).toBe(64);
    const claims = await verifyJwt(token, {
      algorithms: ['ES256'],
      publicKey: p256.publicKey,
    });
    expect(claims.sub).toBe('ec-user');
  });

  it('ES384 round-trips with a raw 96-byte signature', async () => {
    const token = signJwt(
      { sub: 'ec384' },
      { algorithm: 'ES384', privateKey: p384.privateKey, expiresIn: 60 },
    );
    expect(Buffer.from(token.split('.')[2], 'base64url').length).toBe(96);
    const claims = await verifyJwt(token, {
      algorithms: ['ES384'],
      publicKey: p384.publicKey,
    });
    expect(claims.sub).toBe('ec384');
  });

  it('sets kid, subject, issuer, audience and jti from options', async () => {
    const token = signJwt(
      {},
      {
        algorithm: 'RS256',
        privateKey: rsa.privateKey,
        expiresIn: 60,
        keyid: 'key-1',
        subject: 's1',
        issuer: 'https://iss.example.com',
        audience: ['a1', 'a2'],
        jwtid: 'jti-1',
      },
    );
    const { header, payload } = decodeJwt(token);
    expect(header.kid).toBe('key-1');
    expect(header.alg).toBe('RS256');
    expect(payload.sub).toBe('s1');
    expect(payload.iss).toBe('https://iss.example.com');
    expect(payload.aud).toEqual(['a1', 'a2']);
    expect(payload.jti).toBe('jti-1');
  });

  it('rejects signing without key material or with a public key', () => {
    expect(() => signJwt({}, { algorithm: 'RS256' } as any)).toThrow(
      /requires `secret`.*or `privateKey`/,
    );
    expect(() =>
      signJwt({}, { algorithm: 'RS256', privateKey: rsaPubPem }),
    ).toThrow(/Signing requires a private key/);
  });

  it('rejects HS256 signing with a short secret', () => {
    expect(() => signJwt({}, { algorithm: 'HS256', secret: 'short' })).toThrow(
      /at least 32 bytes/,
    );
  });

  it('rejects ES256 signing with a P-384 key (curve mismatch)', () => {
    expect(() =>
      signJwt({}, { algorithm: 'ES256', privateKey: p384.privateKey }),
    ).toThrow(/Curve mismatch/);
  });

  it('rejects RS256 with an EC key (key type mismatch)', () => {
    expect(() =>
      signJwt({}, { algorithm: 'RS256', privateKey: p256.privateKey }),
    ).toThrow(/requires an RSA key/);
  });
});

describe('verifyJwt — algorithm allowlist & alg:none', () => {
  it('exposes the supported algorithm list', () => {
    expect(SUPPORTED_JWT_ALGORITHMS).toContain('RS256');
    expect(SUPPORTED_JWT_ALGORITHMS).toContain('ES384');
    expect(SUPPORTED_JWT_ALGORITHMS).not.toContain('none');
  });

  it.each(['none', 'None', 'NONE', 'nOnE'])(
    'rejects unsigned tokens with alg "%s" regardless of allowlist',
    async (alg) => {
      const token = `${b64urlJson({ alg, typ: 'JWT' })}.${b64urlJson({ sub: 'x' })}.${Buffer.from('garbage').toString('base64url')}`;
      await expect(
        verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
      ).rejects.toThrow(/unsigned \("none"\) tokens are forbidden/);
    },
  );

  it('rejects the classic empty-signature none token (only two real segments)', async () => {
    const token = `${b64urlJson({ alg: 'none' })}.${b64urlJson({ sub: 'x' })}.`;
    await expect(
      verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
    ).rejects.toThrow(/three dot-separated segments/);
  });

  it('"none" can never be allowlisted', () => {
    expect(() => validateAlgorithmAllowlist(['none'])).toThrow(
      /"none" algorithm is not permitted/,
    );
    expect(() => validateAlgorithmAllowlist(['RS256', 'NONE'])).toThrow(
      /"none" algorithm is not permitted/,
    );
  });

  it('rejects an empty or unsupported allowlist', () => {
    expect(() => validateAlgorithmAllowlist([])).toThrow(/non-empty/);
    expect(() => validateAlgorithmAllowlist(['PS256'])).toThrow(
      /Unsupported JWT algorithm/,
    );
  });

  it('rejects a token whose header alg is outside the allowlist', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS384', privateKey: rsa.privateKey, expiresIn: 60 },
    );
    await expect(
      verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
    ).rejects.toThrow(/not in the allowlist/);
  });
});

describe('verifyJwt — algorithm confusion defences', () => {
  it('refuses to allowlist HS* together with a public key', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, expiresIn: 60 },
    );
    await expect(
      verifyJwt(token, {
        algorithms: ['RS256', 'HS256'],
        publicKey: rsa.publicKey,
      }),
    ).rejects.toThrow(/HS\* algorithms cannot be allowlisted/);
  });

  it('refuses to allowlist RS*/ES* together with a symmetric secret', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'HS256', secret: HS_SECRET, expiresIn: 60 },
    );
    await expect(
      verifyJwt(token, { algorithms: ['HS256', 'RS256'], secret: HS_SECRET }),
    ).rejects.toThrow(
      /cannot be allowlisted when.*verifying with a symmetric secret/s,
    );
  });

  it('blocks the key-confusion attack: HS256 token "signed" with the public PEM as secret', async () => {
    // Attacker forges an HS256 token using the server's PUBLIC RSA PEM as the
    // HMAC secret, hoping the verifier feeds the same PEM into an HMAC.
    const forged = signJwt(
      { sub: 'attacker' },
      { algorithm: 'HS256', secret: Buffer.from(rsaPubPem), expiresIn: 60 },
    );
    // Even if the verifier is misconfigured to pass PEM material as `secret`,
    // the key resolver recognises PEM as public material and refuses HS*.
    await expect(
      verifyJwt(forged, { algorithms: ['HS256'], secret: rsaPubPem }),
    ).rejects.toThrow(/Algorithm confusion blocked/);
  });

  it('blocks verifying an RS256 token when only a secret KeyObject is supplied', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, expiresIn: 60 },
    );
    await expect(
      verifyJwt(token, { algorithms: ['RS256'], secret: HS_SECRET } as any),
    ).rejects.toThrow(/cannot be allowlisted/);
  });

  it('requires exactly one of secret / publicKey / keyResolver', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'HS256', secret: HS_SECRET },
    );
    await expect(verifyJwt(token, { algorithms: ['HS256'] })).rejects.toThrow(
      /exactly one of/,
    );
    await expect(
      verifyJwt(token, {
        algorithms: ['HS256'],
        secret: HS_SECRET,
        publicKey: rsaPubPem,
      }),
    ).rejects.toThrow(/exactly one of/);
  });

  it('rejects verification with the wrong RSA public key', async () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, expiresIn: 60 },
    );
    await expect(
      verifyJwt(token, { algorithms: ['RS256'], publicKey: rsa2.publicKey }),
    ).rejects.toThrow(/signature verification failed/);
  });

  it('rejects a tampered payload', async () => {
    const token = signJwt(
      { sub: 'x', admin: false },
      { algorithm: 'RS256', privateKey: rsa.privateKey, expiresIn: 60 },
    );
    const [h, , s] = token.split('.');
    const tampered = `${h}.${b64urlJson({ sub: 'x', admin: true })}.${s}`;
    await expect(
      verifyJwt(tampered, { algorithms: ['RS256'], publicKey: rsa.publicKey }),
    ).rejects.toThrow(/signature verification failed/);
  });
});

describe('verifyJwt — exp/nbf/iat/aud/iss matrix', () => {
  const sign = (claims: Record<string, unknown>) =>
    signJwt(claims, {
      algorithm: 'ES256',
      privateKey: p256.privateKey,
      noTimestamp: true,
    });
  const verify = (token: string, extra: Record<string, unknown> = {}) =>
    verifyJwt(token, {
      algorithms: ['ES256'],
      publicKey: p256.publicKey,
      ...extra,
    });
  const now = Math.floor(Date.now() / 1000);

  it('rejects an expired token, with TokenExpiredError semantics', async () => {
    const token = sign({ exp: now - 60 });
    await expect(verify(token)).rejects.toMatchObject({
      name: 'TokenExpiredError',
    });
  });

  it('accepts an expired token within clockTolerance', async () => {
    const token = sign({ exp: now - 10 });
    await expect(verify(token, { clockTolerance: 30 })).resolves.toBeTruthy();
  });

  it('rejects a not-yet-valid token (nbf), accepts it within tolerance', async () => {
    const token = sign({ nbf: now + 60, exp: now + 120 });
    await expect(verify(token)).rejects.toMatchObject({
      name: 'NotBeforeError',
    });
    await expect(verify(token, { clockTolerance: 90 })).resolves.toBeTruthy();
  });

  it('rejects non-numeric exp/nbf/iat claims', async () => {
    await expect(verify(sign({ exp: 'tomorrow' }))).rejects.toThrow(
      /"exp" claim must be a number/,
    );
  });

  it('enforces maxTokenAge based on iat', async () => {
    const old = sign({ iat: now - 3600, exp: now + 3600 });
    await expect(verify(old, { maxTokenAge: 60 })).rejects.toMatchObject({
      name: 'TokenExpiredError',
    });
    await expect(verify(old, { maxTokenAge: 7200 })).resolves.toBeTruthy();
    await expect(
      verify(sign({ exp: now + 60 }), { maxTokenAge: 60 }),
    ).rejects.toThrow(/missing "iat"/);
    await expect(
      verify(sign({ iat: now + 3600 }), { maxTokenAge: 60 }),
    ).rejects.toThrow(/"iat" claim is in the future/);
  });

  it('honours currentDate for deterministic validation', async () => {
    const token = sign({ exp: 1000 });
    await expect(
      verify(token, { currentDate: new Date(999_000) }),
    ).resolves.toBeTruthy();
    await expect(
      verify(token, { currentDate: new Date(1_001_000) }),
    ).rejects.toMatchObject({ name: 'TokenExpiredError' });
  });

  it('validates iss against a string or one-of array', async () => {
    const token = sign({ iss: 'https://a.example.com', exp: now + 60 });
    await expect(
      verify(token, { issuer: 'https://a.example.com' }),
    ).resolves.toBeTruthy();
    await expect(
      verify(token, {
        issuer: ['https://b.example.com', 'https://a.example.com'],
      }),
    ).resolves.toBeTruthy();
    await expect(
      verify(token, { issuer: 'https://evil.example.com' }),
    ).rejects.toThrow(/"iss" claim mismatch/);
    await expect(
      verify(sign({ exp: now + 60 }), { issuer: 'https://a.example.com' }),
    ).rejects.toThrow(/"iss" claim mismatch/);
  });

  it('validates aud with intersection semantics', async () => {
    const token = sign({ aud: ['api', 'web'], exp: now + 60 });
    await expect(verify(token, { audience: 'api' })).resolves.toBeTruthy();
    await expect(
      verify(token, { audience: ['mobile', 'web'] }),
    ).resolves.toBeTruthy();
    await expect(verify(token, { audience: 'mobile' })).rejects.toThrow(
      /"aud" claim mismatch/,
    );
    await expect(
      verify(sign({ exp: now + 60 }), { audience: 'api' }),
    ).rejects.toThrow(/"aud" claim mismatch/);
  });
});

describe('decodeJwt', () => {
  it('decodes header and payload without verification', () => {
    const token = signJwt(
      { sub: 'x' },
      { algorithm: 'HS256', secret: HS_SECRET, keyid: 'k1' },
    );
    const { header, payload } = decodeJwt(token);
    expect(header).toMatchObject({ alg: 'HS256', typ: 'JWT', kid: 'k1' });
    expect(payload.sub).toBe('x');
  });

  it('throws on malformed tokens', () => {
    expect(() => decodeJwt('only.two')).toThrow(/three dot-separated/);
    expect(() => decodeJwt('!!!.@@@.###')).toThrow(/not valid base64url/);
    const notJson = `${Buffer.from('hello').toString('base64url')}.${b64urlJson({})}.x`;
    expect(() => decodeJwt(notJson)).toThrow(/not valid JSON/);
    const arrayHeader = `${b64urlJson([1, 2])}.${b64urlJson({})}.x`;
    expect(() => decodeJwt(arrayHeader)).toThrow(/must be a JSON object/);
  });
});

describe('createAuthPlugin — asymmetric wiring', () => {
  it('verifies an RS256 token via publicKey and populates req.state.user', async () => {
    const plugin = createAuthPlugin({
      publicKey: rsa.publicKey,
      algorithms: ['RS256'],
      issuer: 'https://iss.example.com',
      audience: 'api',
    });
    const token = signJwt(
      { sub: 'user-9' },
      {
        algorithm: 'RS256',
        privateKey: rsa.privateKey,
        expiresIn: 60,
        issuer: 'https://iss.example.com',
        audience: 'api',
      },
    );
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      state: {},
    };
    const res = mockRes();
    await plugin(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.state.user.sub).toBe('user-9');
  });

  it('returns 401 for expired or foreign-key tokens', async () => {
    const plugin = createAuthPlugin({ publicKey: rsa.publicKey });
    const expired = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, expiresIn: -60 },
    );
    const foreign = signJwt(
      { sub: 'x' },
      { algorithm: 'RS256', privateKey: rsa2.privateKey, expiresIn: 60 },
    );
    for (const token of [expired, foreign]) {
      const res = mockRes();
      await plugin(
        { headers: { authorization: `Bearer ${token}` }, state: {} } as any,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  it('rejects HS* allowlists combined with a public key at creation time', () => {
    expect(() =>
      createAuthPlugin({ publicKey: rsa.publicKey, algorithms: ['HS256'] }),
    ).toThrow(/algorithm-confusion defence/);
    expect(() =>
      createAuthPlugin({
        publicKey: rsa.publicKey,
        algorithms: ['RS256', 'HS256'],
      }),
    ).toThrow(/algorithm-confusion defence/);
  });

  it('requires exactly one of secret / publicKey / jwks', () => {
    expect(() => createAuthPlugin({} as any)).toThrow(/exactly one of/);
    expect(() =>
      createAuthPlugin({
        secret: HS_SECRET,
        publicKey: rsa.publicKey,
      }),
    ).toThrow(/exactly one of/);
  });

  it('enforces the revocation store in the asymmetric path', async () => {
    const store = new MemoryTokenStore();
    const plugin = createAuthPlugin({ publicKey: rsa.publicKey, store });
    const make = (jti?: string) =>
      signJwt(
        { sub: 'x' },
        {
          algorithm: 'RS256',
          privateKey: rsa.privateKey,
          expiresIn: 60,
          ...(jti ? { jwtid: jti } : {}),
        },
      );

    await store.save('live-jti', 60);
    const okRes = mockRes();
    await plugin(
      {
        headers: { authorization: `Bearer ${make('live-jti')}` },
        state: {},
      } as any,
      okRes,
    );
    expect(okRes.status).not.toHaveBeenCalled();

    const revokedRes = mockRes();
    await plugin(
      {
        headers: { authorization: `Bearer ${make('dead-jti')}` },
        state: {},
      } as any,
      revokedRes,
    );
    expect(revokedRes.status).toHaveBeenCalledWith(401);
    expect(revokedRes.send).toHaveBeenCalledWith(
      null,
      expect.stringContaining('revoked'),
    );

    const noJtiRes = mockRes();
    await plugin(
      { headers: { authorization: `Bearer ${make()}` }, state: {} } as any,
      noJtiRes,
    );
    expect(noJtiRes.status).toHaveBeenCalledWith(401);
    expect(noJtiRes.send).toHaveBeenCalledWith(
      null,
      expect.stringContaining('jti'),
    );
    store.close();
  });

  it('fails closed (503) when the store is down in the asymmetric path', async () => {
    const plugin = createAuthPlugin({
      publicKey: rsa.publicKey,
      store: {
        save: async () => {},
        revoke: async () => {},
        exists: async () => {
          throw new Error('redis down');
        },
      },
    });
    const token = signJwt(
      { sub: 'x' },
      {
        algorithm: 'RS256',
        privateKey: rsa.privateKey,
        expiresIn: 60,
        jwtid: 'j1',
      },
    );
    await expect(
      plugin(
        { headers: { authorization: `Bearer ${token}` }, state: {} } as any,
        mockRes(),
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('uses req.state.set when available (write-once user semantics)', async () => {
    const plugin = createAuthPlugin({ publicKey: rsa.publicKey });
    const token = signJwt(
      { sub: 'frozen' },
      { algorithm: 'RS256', privateKey: rsa.privateKey, expiresIn: 60 },
    );
    const bag: Record<string, unknown> = {};
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      state: {
        set: vi.fn((k: string, v: unknown) => {
          bag[k] = v;
        }),
        get: (k: string) => bag[k],
      },
    };
    await plugin(req, mockRes());
    expect(req.state.set).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ sub: 'frozen' }),
    );
  });
});
