import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import jwt from 'jsonwebtoken';
import { createRefreshHandler, useAuth } from '../src/index';

/**
 * These tests cover the paths the original suite missed:
 *   - `createRefreshHandler` in all branches (valid, missing token, invalid
 *     signature, payload without id)
 *   - `useAuth` plugin's happy path (req.user is populated)
 *   - Case-insensitive Bearer scheme extraction (RFC 6750 §2.1)
 *   - Authorization header arriving as an array (Node allows this)
 */
describe('Auth — refresh handler', () => {
  const accessSecret = 'access-secret-that-is-at-least-32-chars-xxx';
  const refreshSecret = 'refresh-secret-that-is-at-least-32-chars-y';

  const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    header: vi.fn().mockReturnThis(),
    headersSent: false,
  });

  it('mints a new access token for a valid refresh token', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
      accessTokenTtl: 60,
    });
    const token = jwt.sign({ id: 'user-42' }, refreshSecret);
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const [[payload]] = res.send.mock.calls;
    expect(payload.expiresIn).toBe(60);
    expect(typeof payload.accessToken).toBe('string');

    // The minted access token should verify against the *access* secret
    const decoded = jwt.verify(payload.accessToken, accessSecret) as any;
    expect(decoded.id).toBe('user-42');
  });

  it('returns 401 when no Authorization header is present', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const req = { headers: {} } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(null, 'Missing refresh token');
  });

  it('returns 401 when the refresh token signature is invalid', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const bogus = jwt.sign({ id: 'x' }, 'a-totally-different-wrong-secret!');
    const req = { headers: { authorization: `Bearer ${bogus}` } } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(null, 'Invalid refresh token');
  });

  it('refuses to mint a token when the refresh payload lacks an id', async () => {
    // Regression: previously, a refresh token with payload {} would mint an
    // access token with `id: undefined`.
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const tokenWithoutId = jwt.sign({}, refreshSecret);
    const req = {
      headers: { authorization: `Bearer ${tokenWithoutId}` },
    } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts `sub` as a valid id on the refresh payload', async () => {
    const handler = createRefreshHandler({
      secret: accessSecret,
      refreshSecret,
    });
    const token = jwt.sign({ sub: 'user-99' }, refreshSecret);
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('Auth — useAuth plugin Bearer extraction', () => {
  const secret = 'plugin-secret-that-is-at-least-32-chars-0';

  const runRequest = async (authHeader: string | string[] | undefined) => {
    const app = new Axiomify();
    useAuth(app, { secret });
    app.route({
      method: 'GET',
      path: '/',
      plugins: ['requireAuth'],
      handler: async (req, res) => res.send({ id: req.user?.id }),
    });

    const req = {
      method: 'GET',
      path: '/',
      headers: authHeader ? { authorization: authHeader } : {},
      id: 'r',
      params: {},
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);
    return res;
  };

  it('populates req.user on a successful verify', async () => {
    const token = jwt.sign({ id: 'user-1' }, secret);
    const res = await runRequest(`Bearer ${token}`);
    expect((res as any).payload).toEqual({ id: 'user-1' });
  });

  it('accepts lowercase "bearer" per RFC 6750 §2.1', async () => {
    // Regression: the scheme name is case-insensitive. Spec-compliant clients
    // sending "bearer xyz" were previously rejected as if no token was sent.
    const token = jwt.sign({ id: 'user-2' }, secret);
    const res = await runRequest(`bearer ${token}`);
    expect((res as any).payload).toEqual({ id: 'user-2' });
  });

  it('accepts uppercase "BEARER"', async () => {
    const token = jwt.sign({ id: 'user-3' }, secret);
    const res = await runRequest(`BEARER ${token}`);
    expect((res as any).payload).toEqual({ id: 'user-3' });
  });

  it('unwraps an array Authorization header', async () => {
    const token = jwt.sign({ id: 'user-4' }, secret);
    const res = await runRequest([`Bearer ${token}`, 'ignored']);
    expect((res as any).payload).toEqual({ id: 'user-4' });
  });

  it('returns 401 when the header is malformed', async () => {
    const res = await runRequest('SomeOtherScheme xyz');
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the header is missing entirely', async () => {
    const res = await runRequest(undefined);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
