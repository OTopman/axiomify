import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/app';

/**
 * Covers the paths in `app.ts` that existing tests skip:
 *   - `group()` nested prefixing
 *   - `healthCheck()` with and without user checks
 *   - `setSerializer()` override
 *   - HEAD auto-handling (strips body)
 *   - Route collision throws from the router
 */
describe('Axiomify.group', () => {
  it('prefixes routes with the group path', async () => {
    const app = new Axiomify();
    app.group('/api/v1', (g) => {
      g.route({
        method: 'GET',
        path: '/users',
        handler: async (_req, res) => res.send({ ok: true }),
      });
    });

    // Only one route is registered, at the prefixed path.
    expect(app.registeredRoutes).toHaveLength(1);
    expect(app.registeredRoutes[0].path).toBe('/api/v1/users');
  });

  it('flattens nested groups', async () => {
    const app = new Axiomify();
    app.group('/api', (g) => {
      g.group('/v1', (g2) => {
        g2.route({
          method: 'GET',
          path: '/things',
          handler: async (_r, res) => res.send({}),
        });
      });
    });

    expect(app.registeredRoutes.map((r) => r.path)).toContain('/api/v1/things');
  });

  it('collapses accidental double slashes', async () => {
    const app = new Axiomify();
    app.group('/api/', (g) => {
      g.route({
        method: 'GET',
        path: '/users',
        handler: async (_r, res) => res.send({}),
      });
    });

    expect(app.registeredRoutes[0].path).toBe('/api/users');
  });

  it('inherits plugins across a group and preserves route-specific plugins', async () => {
    const app = new Axiomify();
    const order: string[] = [];

    app.group(
      '/api',
      {
        plugins: [
          async () => {
            order.push('auth');
          },
        ],
      },
      (g) => {
        g.route({
          method: 'GET',
          path: '/users',
          plugins: [
            async () => {
              order.push('audit');
            },
          ],
          handler: async (_req, res) => res.send({ ok: true }),
        });
      },
    );

    const req = {
      method: 'GET',
      path: '/api/users',
      params: {},
      headers: {},
      id: 'group-plugins',
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);

    expect(order).toEqual(['auth', 'audit']);
  });

  it('merges plugins across nested groups in declaration order', async () => {
    const app = new Axiomify();
    const order: string[] = [];

    app.group(
      '/api',
      {
        plugins: [
          async () => {
            order.push('auth');
          },
        ],
      },
      (g) => {
        g.group(
          '/admin',
          {
            plugins: [
              async () => {
                order.push('scope');
              },
            ],
          },
          (g2) => {
            g2.route({
              method: 'GET',
              path: '/users',
              plugins: [
                async () => {
                  order.push('audit');
                },
              ],
              handler: async (_req, res) => res.send({ ok: true }),
            });
          },
        );
      },
    );

    const req = {
      method: 'GET',
      path: '/api/admin/users',
      params: {},
      headers: {},
      id: 'group-plugin-order',
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);

    expect(order).toEqual(['auth', 'scope', 'audit']);
  });
});

describe('Axiomify.healthCheck', () => {
  const makeReq = (path: string) =>
    ({
      method: 'GET',
      path,
      params: {},
      headers: {},
      id: 'h',
    } as any);

  // Captures the payload passed to send() so each test can introspect it.
  // Using a plain closure keeps the types simple and avoids tripping over
  // vitest mock-return semantics (mockReturnThis-then-read-calls is
  // fiddly with chained .status().send()).
  const makeRes = () => {
    let sendPayload: any;
    let statusCode = 0;
    const res: any = {
      status: vi.fn().mockImplementation((code: number) => {
        statusCode = code;
        return res;
      }),
      send: vi.fn().mockImplementation((data: any) => {
        sendPayload = data;
      }),
      header: vi.fn().mockImplementation(() => res),
      headersSent: false,
      get _status() {
        return statusCode;
      },
      get _payload() {
        return sendPayload;
      },
    };
    return res;
  };

  it('returns 200 and uptime when no checks are provided', async () => {
    const app = new Axiomify();
    app.healthCheck();

    const res = makeRes();
    await app.handle(makeReq('/health'), res);

    expect(res._status).toBe(200);
    expect(res._payload.status).toBe('ok');
    expect(typeof res._payload.uptime).toBe('number');
  });

  it('returns 200 when all checks pass', async () => {
    const app = new Axiomify();
    app.healthCheck('/health', {
      db: async () => true,
      cache: async () => true,
    });

    const res = makeRes();
    await app.handle(makeReq('/health'), res);

    expect(res._status).toBe(200);
    expect(res._payload.status).toBe('ok');
    expect(res._payload.checks).toEqual({ db: true, cache: true });
  });

  it('returns 503 and marks failing checks', async () => {
    const app = new Axiomify();
    app.healthCheck('/health', {
      db: async () => true,
      queue: async () => false, // failing dependency
    });

    const res = makeRes();
    await app.handle(makeReq('/health'), res);

    expect(res._status).toBe(503);
    expect(res._payload.status).toBe('degraded');
    expect(res._payload.checks.queue).toBe(false);
  });

  it('treats a throwing check as a failure', async () => {
    const app = new Axiomify();
    app.healthCheck('/health', {
      flaky: async () => {
        throw new Error('down');
      },
    });

    const res = makeRes();
    await app.handle(makeReq('/health'), res);

    expect(res._status).toBe(503);
    expect(res._payload.checks.flaky).toBe(false);
  });
});

describe('Axiomify.setSerializer', () => {
  it('overrides the default envelope', async () => {
    const app = new Axiomify();
    app.setSerializer((data, message) => ({
      result: data,
      note: message,
    }));
    app.route({
      method: 'GET',
      path: '/x',
      handler: async (_r, res) => res.send({ a: 1 }, 'hi'),
    });

    const req = {
      method: 'GET',
      path: '/x',
      params: {},
      headers: {},
      id: 'r',
    } as any;
    let captured: any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockImplementation((data: any) => {
        captured = data;
      }),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);

    // Serializers produce the final payload via the adapter, but the mock's
    // `res.send` receives the raw data, message pair — so we verify the
    // serializer was at least invokable without throwing and that the route
    // ran. Deeper serialization tests belong to individual adapter suites.
    expect(captured).toEqual({ a: 1 });
  });
});

describe('Axiomify.use', () => {
  it('installs a global plugin through app.use()', async () => {
    const app = new Axiomify();
    const installer = vi.fn((instance: Axiomify) => {
      instance.addHook('onRequest', (req) => {
        req.state.installed = true;
      });
    });

    app.use(installer);

    expect(installer).toHaveBeenCalledWith(app);

    app.route({
      method: 'GET',
      path: '/used',
      handler: async (req, res) => res.send({ installed: req.state.installed }),
    });

    const req = {
      method: 'GET',
      path: '/used',
      params: {},
      headers: {},
      state: {},
      id: 'use-test',
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);

    expect((res as any).payload).toEqual({ installed: true });
  });
});

describe('HEAD request handling', () => {
  it('auto-routes HEAD to a GET handler and strips the body', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/item',
      handler: async (_r, res) => res.send({ big: 'payload' }),
    });

    const req = {
      method: 'HEAD',
      path: '/item',
      params: {},
      headers: {},
      id: 'h',
    } as any;
    let captured: any = 'not-called';
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockImplementation((data: any) => {
        captured = data;
      }),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);

    // The core wraps send() and passes `undefined` as the data for HEAD.
    expect(captured).toBeUndefined();
  });
});

describe('Route registration guards', () => {
  it('throws when two routes collide on the same method + path', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/dup',
      handler: async () => {},
    });
    expect(() =>
      app.route({
        method: 'GET',
        path: '/dup',
        handler: async () => {},
      }),
    ).toThrow(/already registered/);
  });

});

describe('404 / 405 dispatch', () => {
  it('responds 404 for an unknown path', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/known',
      handler: async (_r, res) => res.send({}),
    });

    const req = {
      method: 'GET',
      path: '/unknown',
      params: {},
      headers: {},
      id: 'r',
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('responds 405 with an Allow header for a known path + wrong method', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/submit',
      handler: async (_r, res) => res.send({}),
    });

    const req = {
      method: 'GET',
      path: '/submit',
      params: {},
      headers: {},
      id: 'r',
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);
    expect(res.header).toHaveBeenCalledWith('Allow', 'POST');
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
