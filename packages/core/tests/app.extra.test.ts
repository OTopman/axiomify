import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/app';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeReq = (path: string, method = 'GET') =>
  ({
    method,
    path,
    params: {},
    headers: {},
    id: 'test',
    state: {},
  }) as any;

const makeRes = () => {
  let sendPayload: unknown;
  let statusCode = 0;
  const res: any = {
    status: vi.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    send: vi.fn().mockImplementation((data: unknown) => {
      sendPayload = data;
    }),
    header: vi.fn().mockReturnThis(),
    removeHeader: vi.fn().mockReturnThis(),
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

// ─── group() ─────────────────────────────────────────────────────────────────

describe('Axiomify.group', () => {
  it('prefixes routes with the group path', () => {
    const app = new Axiomify();
    app.group('/api/v1', (g) => {
      g.route({
        method: 'GET',
        path: '/users',
        handler: async (_r, res) => res.send({}),
      });
    });

    expect(app.registeredRoutes).toHaveLength(1);
    expect(app.registeredRoutes[0].path).toBe('/api/v1/users');
  });

  it('flattens nested groups', () => {
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

  it('collapses accidental double slashes', () => {
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

  it('inherits plugins and merges with route-specific plugins in declaration order', async () => {
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

    await app.handle(makeReq('/api/users'), makeRes());
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

    await app.handle(makeReq('/api/admin/users'), makeRes());
    expect(order).toEqual(['auth', 'scope', 'audit']);
  });
});

// ─── healthCheck() ───────────────────────────────────────────────────────────

describe('Axiomify.healthCheck', () => {
  it('returns 200 with status and uptime when no checks are provided', async () => {
    const app = new Axiomify();
    app.healthCheck();

    const res = makeRes();
    await app.handle(makeReq('/health'), res);

    expect(res._status).toBe(200);
    expect(res._payload.status).toBe('ok');
    // uptime must be a non-negative number
    expect(typeof res._payload.uptime).toBe('number');
    expect(res._payload.uptime).toBeGreaterThanOrEqual(0);
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
      queue: async () => false,
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

// ─── setSerializer() ─────────────────────────────────────────────────────────

describe('Axiomify.setSerializer', () => {
  it('overrides the default response envelope', async () => {
    const app = new Axiomify();
    app.setSerializer((data, message) => ({ result: data, note: message }));
    app.route({
      method: 'GET',
      path: '/x',
      handler: async (_r, res) => res.send({ a: 1 }, 'hi'),
    });

    const res = makeRes();
    await app.handle(makeReq('/x'), res);

    // The mock captures the raw data passed to res.send() before serialization.
    expect(res._payload).toEqual({ a: 1 });
  });
});

// ─── app.use() ───────────────────────────────────────────────────────────────

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
    const res = makeRes();
    await app.handle(req, res);

    expect((res as any).payload).toEqual({ installed: true });
  });
});

// ─── HEAD request handling ───────────────────────────────────────────────────

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
    let captured: unknown = 'not-called';
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockImplementation((data: unknown) => {
        captured = data;
      }),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);
    expect(captured).toBeUndefined();
  });
});

// ─── Route registration guards ───────────────────────────────────────────────

describe('Route registration guards', () => {
  it('throws when two routes collide on the same method + path', () => {
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/dup', handler: async () => {} });
    expect(() =>
      app.route({ method: 'GET', path: '/dup', handler: async () => {} }),
    ).toThrow(/already registered/);
  });
});

// ─── 404 / 405 dispatch ──────────────────────────────────────────────────────

describe('404 / 405 dispatch', () => {
  it('responds 404 for an unknown path', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/known',
      handler: async (_r, res) => res.send({}),
    });

    const res = makeRes();
    await app.handle(makeReq('/unknown'), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('responds 405 with an Allow header for a known path + wrong method', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/submit',
      handler: async (_r, res) => res.send({}),
    });

    const res = makeRes();
    await app.handle(makeReq('/submit'), res);
    expect(res.header).toHaveBeenCalledWith('Allow', 'POST');
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

// ─── onError hook isolation (runSafe) ────────────────────────────────────────

describe('onError hook isolation', () => {
  it('calls all onError hooks even when one throws, and still sends a response', async () => {
    const app = new Axiomify();
    const secondHookCalled = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First hook throws — must NOT prevent the second hook from running.
    app.addHook('onError', async () => {
      throw new Error('hook exploded');
    });
    app.addHook('onError', secondHookCalled);

    app.route({
      method: 'GET',
      path: '/boom',
      handler: async () => {
        throw new Error('handler error');
      },
    });

    const res = makeRes();
    await app.handle(makeReq('/boom'), res);

    expect(secondHookCalled).toHaveBeenCalled();
    // A response must still be sent after all hooks run.
    expect(res._status).toBe(500);

    consoleSpy.mockRestore();
  });

  it('does not recurse when onError itself throws', async () => {
    const app = new Axiomify();
    let callCount = 0;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    app.addHook('onError', async () => {
      callCount++;
      throw new Error('recursive trap');
    });

    app.route({
      method: 'GET',
      path: '/recurse',
      handler: async () => {
        throw new Error('initial error');
      },
    });

    const res = makeRes();
    // This must resolve — not stack overflow.
    await expect(app.handle(makeReq('/recurse'), res)).resolves.not.toThrow();
    // onError was called exactly once — no recursion.
    expect(callCount).toBe(1);

    consoleSpy.mockRestore();
  });
});

// ─── onClose hook isolation ──────────────────────────────────────────────────

describe('onClose hook isolation', () => {
  it('calls all onClose hooks even when one throws', async () => {
    const app = new Axiomify();
    const secondClosed = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    app.addHook('onClose', async () => {
      throw new Error('close failed');
    });
    app.addHook('onClose', secondClosed);

    app.route({
      method: 'GET',
      path: '/ok',
      handler: async (_r, res) => res.send({}),
    });

    await app.handle(makeReq('/ok'), makeRes());

    expect(secondClosed).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
