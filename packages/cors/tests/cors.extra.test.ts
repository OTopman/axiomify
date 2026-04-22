import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useCors } from '../src/index';

/**
 * Extends the existing two-case CORS suite to cover every branch:
 *   - Allow-list origin that matches
 *   - Wildcard does not set Vary: Origin
 *   - `credentials: true` with `origin: '*'` throws at setup time
 *   - `exposedHeaders` option
 *   - OPTIONS preflight sends 204 with Max-Age
 */
describe('CORS Plugin — extended', () => {
  const makeReq = (method: string, origin?: string) =>
    ({
      method,
      path: '/',
      headers: origin ? { origin } : {},
      id: 'c',
      params: {},
    } as any);

  const makeRes = () => {
    const headers: Record<string, string> = {};
    return {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockImplementation((k: string, v: string) => {
        headers[k] = v;
      }),
      headersSent: false,
      _headers: headers,
    } as any;
  };

  it('reflects an allowed origin from an array', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['http://safe.com', 'http://also-safe.com'] });
    app.route({
      method: 'GET',
      path: '/',
      handler: async (_r, res) => res.send('ok'),
    });

    const res = makeRes();
    await app.handle(makeReq('GET', 'http://also-safe.com'), res);
    expect(res.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://also-safe.com',
    );
    expect(res.header).toHaveBeenCalledWith('Vary', 'Origin');
  });

  it('does NOT emit Vary: Origin when origin is "*"', async () => {
    const app = new Axiomify();
    useCors(app, { origin: '*' });
    app.route({
      method: 'GET',
      path: '/',
      handler: async (_r, res) => res.send('ok'),
    });

    const res = makeRes();
    await app.handle(makeReq('GET'), res);
    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.header).not.toHaveBeenCalledWith('Vary', 'Origin');
  });

  it('throws at setup when credentials:true and origin:"*" are combined', () => {
    // Regression: browsers reject this combination. The plugin should fail
    // loudly at boot rather than silently emit a response no browser will
    // honour.
    const app = new Axiomify();
    expect(() => useCors(app, { credentials: true, origin: '*' })).toThrow(
      /cannot be combined/,
    );
  });

  it('emits Access-Control-Expose-Headers when configured', async () => {
    const app = new Axiomify();
    useCors(app, { exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'] });
    app.route({
      method: 'GET',
      path: '/',
      handler: async (_r, res) => res.send('ok'),
    });

    const res = makeRes();
    await app.handle(makeReq('GET'), res);
    expect(res.header).toHaveBeenCalledWith(
      'Access-Control-Expose-Headers',
      'X-Request-Id, X-RateLimit-Remaining',
    );
  });

  it('short-circuits OPTIONS preflight with 204 and Max-Age', async () => {
    const app = new Axiomify();
    useCors(app, { maxAge: 600 });
    // No route needed — the preflight should not touch handlers at all.

    const res = makeRes();
    await app.handle(makeReq('OPTIONS', 'http://any.example'), res);

    expect(res.header).toHaveBeenCalledWith('Access-Control-Max-Age', '600');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('appends Access-Control-Request-Headers to existing Vary values', async () => {
    const app = new Axiomify();
    useCors(app, { origin: 'http://trusted.example' });

    const res = makeRes();
    res._headers.Vary = 'Origin';

    await app.handle(
      {
        method: 'OPTIONS',
        path: '/',
        headers: {
          origin: 'http://trusted.example',
          'access-control-request-headers': 'x-custom-header',
        },
        id: 'c',
        params: {},
      } as any,
      res,
    );

    expect(res.header).toHaveBeenCalledWith(
      'Vary',
      'Origin, Access-Control-Request-Headers',
    );
  });

  it('emits Access-Control-Allow-Credentials when credentials:true and origin is specific', async () => {
    const app = new Axiomify();
    useCors(app, {
      credentials: true,
      origin: 'http://trusted.example',
    });
    app.route({
      method: 'GET',
      path: '/',
      handler: async (_r, res) => res.send('ok'),
    });

    const res = makeRes();
    await app.handle(makeReq('GET', 'http://trusted.example'), res);
    expect(res.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Credentials',
      'true',
    );
  });
});
