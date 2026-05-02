import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../../core/src/app';
import jwt from 'jsonwebtoken';
import {
  createAuthPlugin,
  createRefreshHandler,
  getAuthUser,
  MemoryTokenStore,
} from '../src/index';

describe('Auth — refresh handler', () => {
  const accessSecret = 'access-secret-that-is-at-least-32-chars-xxx';
  const refreshSecret = 'refresh-secret-that-is-at-least-32-chars-yyy';

  const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    header: vi.fn().mockReturnThis(),
    headersSent: false,
  });

  it('returns a promise (async verification path)', () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const req = { headers: {} } as any;
    const res = makeRes();
    expect(handler(req, res)).instanceOf(Promise);
  });

  it('accepts token first use, then rejects after revoke', async () => {
    const store = new MemoryTokenStore();
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
      store,
      refreshTokenTtl: 60,
    });
    const jti = 'refresh-jti-1';
    await store.save(jti, 60);
    const token = jwt.sign({ id: 'u1', jti }, refreshSecret);

    const res1 = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res1 as any,
    );
    expect(res1.status).toHaveBeenCalledWith(200);

    const res2 = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res2 as any,
    );
    expect(res2.status).toHaveBeenCalledWith(401);
  });

  it('rejects refresh tokens without jti when store is configured', async () => {
    const store = new MemoryTokenStore();
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
      store,
    });
    const token = jwt.sign({ id: 'u1' }, refreshSecret);
    const res = makeRes();
    await handler(
      { headers: { authorization: `Bearer ${token}` } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('expires token from store after ttl', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryTokenStore();
      await store.save('ttl-jti', 1);
      expect(await store.exists('ttl-jti')).toBe(true);
      vi.advanceTimersByTime(1_100);
      expect(await store.exists('ttl-jti')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Auth — route plugin Bearer extraction', () => {
  const secret = 'plugin-secret-that-is-at-least-32-chars-0';
  const runRequest = async (authHeader: string | string[] | undefined) => {
    const app = new Axiomify();
    const requireAuth = createAuthPlugin({ secret });
    app.route({ method: 'GET', path: '/', plugins: [requireAuth], handler: async (req, res) => res.send({ id: req.user?.id }) });
    const req = { method: 'GET', path: '/', headers: authHeader ? { authorization: authHeader } : {}, id: 'r', params: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis(), headersSent: false } as any;
    await app.handle(req, res);
    return res;
  };

  it('populates auth user in request state on a successful verify', async () => {
    const token = jwt.sign({ id: 'user-1' }, secret);
    const res = await runRequest(`Bearer ${token}`);
    expect((res as any).payload).toEqual({ id: 'user-1' });
  });

  it('rejects string JWT payloads for auth plugin', async () => {
    const token = jwt.sign('raw-string-payload', secret);
    const res = await runRequest(`Bearer ${token}`);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
