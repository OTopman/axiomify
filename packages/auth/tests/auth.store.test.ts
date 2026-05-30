import jwt from 'jsonwebtoken';
import cluster from 'cluster';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../../core/src/app';
import {
  createAuthPlugin,
  createRefreshHandler,
  MemoryTokenStore,
  type TokenStore,
} from '../src/index';

const accessSecret = 'access-secret-that-is-at-least-32-chars-xxx';
const refreshSecret = 'refresh-secret-that-is-at-least-32-chars-yyy';

const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  send: vi.fn(),
  header: vi.fn().mockReturnThis(),
  headersSent: false,
});

describe('MemoryTokenStore — production warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const original = process.env.NODE_ENV;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = original;
  });

  it('emits a warning when constructed in production', () => {
    process.env.NODE_ENV = 'production';
    new MemoryTokenStore();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('MemoryTokenStore is per-process'),
    );
  });
});

describe('createRefreshHandler — store failure paths', () => {
  it('returns 503 when store.exists throws (store unavailable)', async () => {
    const store: TokenStore = {
      save: vi.fn(),
      exists: vi.fn(async () => {
        throw new Error('redis down');
      }),
      revoke: vi.fn(),
    };
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
      store,
    });
    const token = jwt.sign({ id: 'u1', jti: 'j1' }, refreshSecret);
    const res = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res as any,
    );
    // Infrastructure failures now surface as 503 (was 401 in the old code that
    // swallowed all errors in the outer catch).
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('does NOT revoke the old token when store.save fails on the new one', async () => {
    const revoke = vi.fn();
    const store: TokenStore = {
      save: vi.fn(async () => {
        throw new Error('redis write failed');
      }),
      exists: vi.fn(async () => true),
      revoke,
    };
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
      store,
    });
    const token = jwt.sign({ id: 'u1', jti: 'old-jti' }, refreshSecret);
    const res = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(503);
    // Critical: the old jti must NOT have been revoked, so the client can
    // safely retry the refresh request.
    expect(revoke).not.toHaveBeenCalled();
  });

  it('returns 401 when refresh token signature is invalid', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const res = makeRes();
    await handler(
      { headers: { authorization: 'Bearer not.a.real.token' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('Auth — option branch coverage', () => {
  it('throws when every provided algorithm is blocked (e.g. "none")', async () => {
    const { createAuthPlugin } = await import('../src/index');
    expect(() =>
      createAuthPlugin({
        secret: accessSecret,
        algorithms: ['none' as any, 'NONE' as any],
      }),
    ).toThrow(/none/);
  });

  it('default getToken handles array authorization header', async () => {
    const { createAuthPlugin } = await import('../src/index');
    const requireAuth = createAuthPlugin({ secret: accessSecret });
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/multi',
      plugins: [requireAuth],
      handler: async (_r, res) => res.send({}),
    });
    const token = jwt.sign({ id: 'u1' }, accessSecret);
    const req = {
      method: 'GET',
      path: '/multi',
      headers: { authorization: [`Bearer ${token}`, `Bearer other`] },
      id: 'r',
      params: {},
      query: {},
      state: {},
      body: undefined,
      url: '/multi',
      ip: '127.0.0.1',
    } as any;
    const res = makeRes() as any;
    await app.handle(req, res);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it('default getToken returns null when authorization header is missing', async () => {
    const { createAuthPlugin } = await import('../src/index');
    const requireAuth = createAuthPlugin({ secret: accessSecret });
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/none',
      plugins: [requireAuth],
      handler: async (_r, res) => res.send({}),
    });
    const req = {
      method: 'GET',
      path: '/none',
      headers: {},
      id: 'r',
      params: {},
      query: {},
      state: {},
      body: undefined,
      url: '/none',
      ip: '127.0.0.1',
    } as any;
    const res = makeRes() as any;
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('throws in production when secret is too short', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { createAuthPlugin } = await import('../src/index');
      expect(() => createAuthPlugin({ secret: 'short' })).toThrow(/32 bytes/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('warns in development when secret is too short', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createAuthPlugin } = await import('../src/index');
    createAuthPlugin({ secret: 'short' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bytes.*256 bits/));
    warn.mockRestore();
  });

  it('issuer/audience options are passed through', async () => {
    const { createAuthPlugin } = await import('../src/index');
    const requireAuth = createAuthPlugin({
      secret: accessSecret,
      issuer: 'iss-x',
      audience: 'aud-y',
    });
    const token = jwt.sign({ id: 'u1' }, accessSecret, {
      issuer: 'iss-x',
      audience: 'aud-y',
    });
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/iss',
      plugins: [requireAuth],
      handler: async (_r, res) => res.send({}),
    });
    const req = {
      method: 'GET',
      path: '/iss',
      headers: { authorization: `Bearer ${token}` },
      id: 'r',
      params: {},
      query: {},
      state: {},
      body: undefined,
      url: '/iss',
      ip: '127.0.0.1',
    } as any;
    const res = makeRes() as any;
    await app.handle(req, res);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it('createAuthPlugin: missing jti in payload returns 401 when store is set', async () => {
    const { createAuthPlugin, MemoryTokenStore } = await import('../src/index');
    const store = new MemoryTokenStore();
    const requireAuth = createAuthPlugin({ secret: accessSecret, store });
    const tokenWithoutJti = jwt.sign({ id: 'u1' }, accessSecret); // no jti
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/njti',
      plugins: [requireAuth],
      handler: async (_r, res) => res.send({}),
    });
    const req = {
      method: 'GET',
      path: '/njti',
      headers: { authorization: `Bearer ${tokenWithoutJti}` },
      id: 'r',
      params: {},
      query: {},
      state: {},
      body: undefined,
      url: '/njti',
      ip: '127.0.0.1',
    } as any;
    const res = makeRes() as any;
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('createRefreshHandler: array authorization header is unwrapped', async () => {
    const { createRefreshHandler } = await import('../src/index');
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const token = jwt.sign({ id: 'u1', jti: 'j-1' }, refreshSecret);
    const res = makeRes();
    await handler(
      { headers: { authorization: [`Bearer ${token}`] } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('createAuthPlugin — store failure paths', () => {
  it('propagates a 503 when store.exists throws on access verification', async () => {
    const app = new Axiomify();
    const store: TokenStore = {
      save: vi.fn(),
      exists: vi.fn(async () => {
        throw new Error('redis down');
      }),
      revoke: vi.fn(),
    };
    const requireAuth = createAuthPlugin({ secret: accessSecret, store });
    app.route({
      method: 'GET',
      path: '/protected',
      plugins: [requireAuth],
      handler: async (_r, res) => res.send({}),
    });
    const token = jwt.sign({ id: 'u1', jti: 'j1' }, accessSecret);
    const req = {
      method: 'GET',
      path: '/protected',
      headers: { authorization: `Bearer ${token}` },
      id: 'r',
      params: {},
      query: {},
      state: {},
      body: undefined,
      url: '/protected',
      ip: '127.0.0.1',
    } as any;
    const res = makeRes() as any;
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe('MemoryTokenStore — functional behavior', () => {
  it('saves, checks existence, revokes, and prunes tokens correctly', async () => {
    const store = new MemoryTokenStore();
    try {
      const jti = 'test-token-jti';

      expect(await store.exists(jti)).toBe(false);

      await store.save(jti, 1);
      expect(await store.exists(jti)).toBe(true);

      await store.revoke(jti);
      expect(await store.exists(jti)).toBe(false);

      await store.save(jti, -1);
      expect(await store.exists(jti)).toBe(false);

      const otherJti = 'other-token-jti';
      await store.save(otherJti, -1);
      (store as any).prune();
      expect(await store.exists(otherJti)).toBe(false);
    } finally {
      store.close();
    }
  });
});

describe('MemoryTokenStore — clustered mode', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalIsWorker = cluster.isWorker;
  const originalWorkers = cluster.workers;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
    Object.defineProperty(cluster, 'isWorker', {
      value: originalIsWorker,
      configurable: true,
    });
    Object.defineProperty(cluster, 'workers', {
      value: originalWorkers,
      configurable: true,
    });
  });

  it('throws in production when constructed inside a cluster worker', () => {
    process.env.NODE_ENV = 'production';
    Object.defineProperty(cluster, 'isWorker', {
      value: true,
      configurable: true,
    });
    expect(() => new MemoryTokenStore()).toThrow(
      /cannot be used in clustered mode/,
    );
  });

  it('warns in development when constructed inside a cluster worker', () => {
    process.env.NODE_ENV = 'development';
    Object.defineProperty(cluster, 'isWorker', {
      value: true,
      configurable: true,
    });
    new MemoryTokenStore();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cannot be used in clustered mode'),
    );
  });

  it('warns in development when constructed with cluster workers present', () => {
    process.env.NODE_ENV = 'development';
    Object.defineProperty(cluster, 'isWorker', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(cluster, 'workers', {
      value: { worker1: {} },
      configurable: true,
    });
    new MemoryTokenStore();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cannot be used in clustered mode'),
    );
  });
});

describe('createRefreshHandler — additional failure paths', () => {
  it('returns 500 when token signing fails', async () => {
    const token = jwt.sign({ id: 'u1', jti: 'j-1' }, refreshSecret);
    const signSpy = vi
      .spyOn(jwt, 'sign')
      .mockImplementation((payload, secret, options, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('Mock signing error'), undefined);
        }
        return '';
      });
    try {
      const handler = createRefreshHandler({
        secret: accessSecret,
        refreshSecret,
      });
      const res = makeRes();
      await handler(
        { headers: { authorization: `Bearer ${token}` } } as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(500);
    } finally {
      signSpy.mockRestore();
    }
  });

  it('swallows errors when store.revoke throws during token refresh', async () => {
    const store: TokenStore = {
      save: vi.fn(),
      exists: vi.fn(async () => true),
      revoke: vi.fn(async () => {
        throw new Error('redis revoke error');
      }),
    };
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
      store,
    });
    const token = jwt.sign({ id: 'u1', jti: 'old-jti' }, refreshSecret);
    const res = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(store.revoke).toHaveBeenCalledWith('old-jti');
  });
});

describe('Auth — additional branch coverage', () => {
  it('extractBearer returns null for invalid Bearer format', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const res = makeRes();
    await handler(
      { headers: { authorization: 'Basic plain' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('signAsync rejects with token signing failed when err and token are both null', async () => {
    const token = jwt.sign({ id: 'u1', jti: 'j-1' }, refreshSecret);
    const signSpy = vi
      .spyOn(jwt, 'sign')
      .mockImplementation((payload, secret, options, callback) => {
        if (typeof callback === 'function') {
          // both err and token are falsy/null
          callback(null as any, null as any);
        }
        return '';
      });
    try {
      const handler = createRefreshHandler({
        secret: accessSecret,
        refreshSecret,
      });
      const res = makeRes();
      await handler(
        { headers: { authorization: `Bearer ${token}` } } as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(500);
    } finally {
      signSpy.mockRestore();
    }
  });

  it('uses sub field when id is missing in refresh token', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    // payload has sub but no id
    const token = jwt.sign({ sub: 'u-sub', jti: 'j-sub' }, refreshSecret);
    const res = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('re-throws error in authenticate middleware when error lacks a name', async () => {
    const requireAuth = createAuthPlugin({
      secret: accessSecret,
    });
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/auth-error-no-name',
      plugins: [requireAuth],
      handler: async (_r, res) => res.send({}),
    });
    const token = jwt.sign({ id: 'u1' }, accessSecret);
    const verifySpy = vi
      .spyOn(jwt, 'verify')
      .mockImplementation((token, secret, options, callback) => {
        if (typeof callback === 'function') {
          callback('custom-string-error' as any, undefined);
        }
        return {} as any;
      });
    try {
      const req = {
        method: 'GET',
        path: '/auth-error-no-name',
        headers: { authorization: `Bearer ${token}` },
        id: 'r',
        params: {},
        query: {},
        state: {},
        body: undefined,
        url: '/auth-error-no-name',
        ip: '127.0.0.1',
      } as any;
      const res = makeRes() as any;
      await app.handle(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    } finally {
      verifySpy.mockRestore();
    }
  });
});
