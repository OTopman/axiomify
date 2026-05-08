import { Axiomify } from '../../core/src/app';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthPlugin,
  createRefreshHandler,
  getAuthUser,
  MemoryTokenStore,
  useAuth,
} from '../src/index';
describe('Auth Plugin & Refresh', () => {
  const secret = 'super-secret-key-that-is-at-least-32-chars-long!';

  it('warns on short secret', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createAuthPlugin({ secret: 'short' });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('shorter than 32 characters'),
    );
    spy.mockRestore();
  });

  it('uses custom getToken', async () => {
    const app = new Axiomify();
    const requireAuth = createAuthPlugin({
      secret,
      getToken: (req) => req.headers['x-token'] as string,
    });
    app.route({
      method: 'GET',
      path: '/',
      plugins: [requireAuth],
      handler: async (req, res) => res.send({ id: getAuthUser(req)?.id }),
    });

    const token = jwt.sign({ id: 123 }, secret);
    const req = {
      method: 'GET',
      path: '/',
      headers: { 'x-token': token },
      id: '1',
      params: {},
      state: {},
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
      header: vi.fn().mockReturnThis(),
    } as any;

    await app.handle(req, res);
    // .payload was set by ValidatingResponse as a side-effect; schema-less routes
    // now bypass that wrapper. Read directly from the send() mock call instead.
    expect(res.send.mock.calls[0][0]).toEqual({ id: 123 });
  });

  it('returns 401 on wrong secret or expired token', async () => {
    const app = new Axiomify();
    const requireAuth = useAuth({ secret });
    app.route({
      method: 'GET',
      path: '/',
      plugins: [requireAuth],
      handler: async () => {},
    });

    const badToken = jwt.sign({ id: 1 }, 'wrong-secret');
    const req1 = {
      method: 'GET',
      path: '/',
      headers: { authorization: `Bearer ${badToken}` },
      id: '2',
      params: {},
      state: {},
    } as any;
    const res1 = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
      header: vi.fn().mockReturnThis(),
    } as any;
    await app.handle(req1, res1);
    expect(res1.status).toHaveBeenCalledWith(401);

    const expiredToken = jwt.sign({ id: 1 }, secret, { expiresIn: '-1h' });
    const req2 = {
      method: 'GET',
      path: '/',
      headers: { authorization: `Bearer ${expiredToken}` },
      id: '3',
      params: {},
      state: {},
    } as any;
    const res2 = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
      header: vi.fn().mockReturnThis(),
    } as any;
    await app.handle(req2, res2);
    expect(res2.status).toHaveBeenCalledWith(401);
  });
});

// ─── Access token revocation via store ────────────────────────────────────────

describe('createAuthPlugin — access token revocation via store', () => {
  const secret = 'a-very-long-secret-for-testing-purposes-only-12345';
  const store = new MemoryTokenStore();

  it('accepts a token whose jti exists in the store', async () => {
    const jti = 'test-jti-valid';
    const { sign } = await import('jsonwebtoken');
    const token = sign({ id: 'user-1', jti }, secret, { expiresIn: 60 });

    await store.save(jti, 60);

    const plugin = createAuthPlugin({ secret, store });
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      state: {},
    };
    const res: any = { status: vi.fn().mockReturnThis(), send: vi.fn() };

    await plugin(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(req.state.authUser).toBeDefined();
    expect(req.state.authUser.id).toBe('user-1');
  });

  it('rejects a token whose jti was revoked from the store', async () => {
    const jti = 'test-jti-revoked';
    const { sign } = await import('jsonwebtoken');
    const token = sign({ id: 'user-2', jti }, secret, { expiresIn: 60 });

    await store.save(jti, 60);
    await store.revoke(jti);

    const plugin = createAuthPlugin({ secret, store });
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      state: {},
    };
    const res: any = { status: vi.fn().mockReturnThis(), send: vi.fn() };

    await plugin(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(
      null,
      expect.stringMatching(/revoked/i),
    );
  });

  it('rejects a token with no jti when store is configured', async () => {
    const { sign } = await import('jsonwebtoken');
    const token = sign({ id: 'user-3' }, secret, { expiresIn: 60 }); // no jti

    const plugin = createAuthPlugin({ secret, store });
    const req: any = {
      headers: { authorization: `Bearer ${token}` },
      state: {},
    };
    const res: any = { status: vi.fn().mockReturnThis(), send: vi.fn() };

    await plugin(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(null, expect.stringMatching(/jti/i));
  });
});

// ─── MemoryTokenStore: setTimeout overflow protection ─────────────────────────

describe('MemoryTokenStore — long-TTL overflow protection', () => {
  it('does not immediately delete tokens with TTL > 24.9 days', async () => {
    const store = new MemoryTokenStore();
    const jti = 'long-lived-token';

    // 30-day token: 2,592,000 seconds — overflows Node's 32-bit setTimeout limit
    await store.save(jti, 30 * 24 * 3600);

    // Token must still exist immediately after save
    const exists = await store.exists(jti);
    expect(exists).toBe(true);

    await store.revoke(jti);
  });

  it('still correctly expires short-TTL tokens', async () => {
    const store = new MemoryTokenStore();
    const jti = 'short-lived';

    await store.save(jti, 0.001); // 1ms TTL
    await new Promise((r) => setTimeout(r, 50)); // wait for expiry

    const exists = await store.exists(jti);
    expect(exists).toBe(false);
  });
});
