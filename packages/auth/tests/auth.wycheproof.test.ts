import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createAuthPlugin } from '../src/index';

describe('Auth Plugin — Wycheproof JWT Security Test Vectors', () => {
  // Generate a standard robust 256-bit HMAC secret
  const hmacSecret = 'super-secret-key-that-is-at-least-32-chars-long!';

  // Generate an RSA Key Pair dynamically for Algorithm Confusion tests
  const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Helper to build mock request and response
  const makeRequest = (token: string | null) => {
    return {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      state: {},
    } as any;
  };

  const makeResponse = () => {
    return {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as any;
  };

  // 1. Algorithm Confusion tests
  describe('Algorithm Confusion (HMAC using RSA Public Key)', () => {
    it('rejects a token signed with RS256 using RSA private key when verifying with public key as symmetric secret', async () => {
      // Sign token using RSA private key via RS256
      const token = jwt.sign({ id: 'user-1' }, rsaPrivateKey, { algorithm: 'RS256' });

      // Configure plugin using the public key as the HMAC symmetric secret.
      // If we attempt to verify, it should reject because the alg is RS256,
      // and HS256 is pinned by default (or pinned specifically).
      const plugin = createAuthPlugin({
        secret: rsaPublicKey,
        algorithms: ['HS256'],
      });

      const req = makeRequest(token);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });

    it('rejects a token forged using HS256 signed with the RSA public key if algorithms is pinned to RS256', async () => {
      // Attacker signature forgery: signs using HS256 but signs it with the PUBLIC key
      const token = jwt.sign({ id: 'user-1' }, rsaPublicKey, { algorithm: 'HS256' });

      // Target configuration is RS256
      const plugin = createAuthPlugin({
        secret: rsaPublicKey,
        algorithms: ['RS256'],
      });

      const req = makeRequest(token);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });
  });

  // 2. none algorithm validation
  describe('"none" Algorithm Injection', () => {
    it('fails on startup if none is passed in the algorithms array', () => {
      expect(() => {
        createAuthPlugin({ secret: hmacSecret, algorithms: ['none' as any] });
      }).toThrow(/rejected.*none/i);

      expect(() => {
        createAuthPlugin({ secret: hmacSecret, algorithms: ['NONE' as any] });
      }).toThrow(/rejected.*none/i);
    });

    it('rejects token with alg: none in header', async () => {
      // Create a token with alg: none. Under RFC 7519, none-tokens have no signature.
      // We manually construct it: header.payload.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ id: 'user-1' })).toString('base64url');
      const token = `${header}.${payload}.`;

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(token);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });

    it('rejects token with alg: NONE (case variation)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'NONE', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ id: 'user-1' })).toString('base64url');
      const token = `${header}.${payload}.`;

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(token);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });
  });

  // 3. Signature tampering and malformed signatures
  describe('Signature Tampering', () => {
    it('rejects token with modified signature byte', async () => {
      const validToken = jwt.sign({ id: 'user-1' }, hmacSecret);
      const parts = validToken.split('.');
      // Mutate one char in the signature part
      const modifiedSignature = parts[2].substring(0, parts[2].length - 1) + (parts[2].endsWith('A') ? 'B' : 'A');
      const tamperedToken = `${parts[0]}.${parts[1]}.${modifiedSignature}`;

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(tamperedToken);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });

    it('rejects token with empty signature', async () => {
      const validToken = jwt.sign({ id: 'user-1' }, hmacSecret);
      const parts = validToken.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.`;

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(tamperedToken);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });

    it('rejects token with trailing garbage in signature', async () => {
      const validToken = jwt.sign({ id: 'user-1' }, hmacSecret);
      const tamperedToken = validToken + 'garbage';

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(tamperedToken);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });
  });

  // 4. Temporal Validation (exp and nbf claims)
  describe('Temporal Validation (exp / nbf)', () => {
    it('rejects expired tokens', async () => {
      const token = jwt.sign({ id: 'user-1', exp: Math.floor(Date.now() / 1000) - 10 }, hmacSecret);

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(token);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });

    it('rejects tokens used before nbf (not before) time', async () => {
      const token = jwt.sign({ id: 'user-1', nbf: Math.floor(Date.now() / 1000) + 120 }, hmacSecret);

      const plugin = createAuthPlugin({ secret: hmacSecret });
      const req = makeRequest(token);
      const res = makeResponse();

      await plugin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.state.user).toBeUndefined();
    });
  });
});
