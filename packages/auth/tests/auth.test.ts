import { Axiomify } from '@axiomify/core';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { createAuthPlugin, getAuthUser, useAuth } from '../src/index';

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
    expect((res as any).payload).toEqual({ id: 123 });
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
