import { describe, expect, it, vi, afterEach } from 'vitest';
import { Axiomify, ADAPTER_LOCK_TOKEN } from '../src/index';

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1',
    method: 'GET',
    url: '/',
    path: '/',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  };
}

function makeRes(overrides: any = {}): any {
  const headers: Record<string, string> = {};
  let sent = false;
  const res: any = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn().mockReturnThis(),
    send: vi.fn(() => {
      sent = true;
    }),
    sendRaw: vi.fn(),
    error: vi.fn(),
    stream: vi.fn(),
    get headersSent() {
      return sent;
    },
    statusCode: 200,
    raw: {},
    capabilities: { sse: false, streaming: false },
    get headers() {
      return headers;
    },
    ...overrides,
  };
  return res;
}

describe('Axiomify app — extended coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('lockRoutes token guard', () => {
    it('throws when called without ADAPTER_LOCK_TOKEN', () => {
      const app = new Axiomify();
      expect(() => (app as any).lockRoutes('bad-token')).toThrow(
        /requires the ADAPTER_LOCK_TOKEN/,
      );
    });

    it('prevents route registration after lock', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN, 'test');
      expect(() =>
        app.route({
          method: 'GET',
          path: '/late',
          handler: async (_r, res) => res.send({}),
        }),
      ).toThrow(/after adapter binding/);
    });
  });

  describe('setSerializer', () => {
    it('returns this for chaining', () => {
      const app = new Axiomify();
      expect(app.setSerializer(({ data }: any) => data)).toBe(app);
    });

    it('serializer getter reflects the set function', () => {
      const app = new Axiomify();
      const myFn = ({ data }: any) => ({ custom: data });
      app.setSerializer(myFn);
      // The getter returns a wrapped version; just verify it is callable
      const result = app.serializer({ data: 42, isError: false });
      expect(result).toMatchObject({ custom: 42 });
    });
  });

  describe('enableRequestId', () => {
    it('injects X-Request-Id on response', async () => {
      const app = new Axiomify();
      app.enableRequestId();
      app.route({
        method: 'GET',
        path: '/id',
        handler: async (_r, res) => res.send({}),
      });
      const req = makeReq({ path: '/id' });
      const res = makeRes();
      await app.handle(req, res);
      expect(res.header).toHaveBeenCalledWith(
        'X-Request-Id',
        expect.any(String),
      );
    });

    it('respects upstream x-request-id header', async () => {
      const app = new Axiomify();
      app.enableRequestId();
      app.route({
        method: 'GET',
        path: '/id2',
        handler: async (_r, res) => res.send({}),
      });
      const req = makeReq({
        path: '/id2',
        headers: { 'x-request-id': 'upstream-123' },
      });
      const res = makeRes();
      await app.handle(req, res);
      expect(res.header).toHaveBeenCalledWith('X-Request-Id', 'upstream-123');
    });

    it('returns this for chaining', () => {
      const app = new Axiomify();
      expect(app.enableRequestId()).toBe(app);
    });
  });

  describe('group — plugin inheritance', () => {
    it('applies group plugins to routes', async () => {
      const app = new Axiomify();
      const pluginSpy = vi.fn(async () => {});
      let handlerCalled = false;
      app.group('/admin', { plugins: [pluginSpy] }, (g) => {
        g.route({
          method: 'GET',
          path: '/users',
          handler: async (_r, res) => {
            handlerCalled = true;
            res.send({});
          },
        });
      });
      const req = makeReq({ path: '/admin/users' });
      const res = makeRes();
      await app.handle(req, res);
      expect(pluginSpy).toHaveBeenCalledOnce();
      expect(handlerCalled).toBe(true);
    });

    it('merges parent and child plugins', async () => {
      const app = new Axiomify();
      const parentPlugin = vi.fn(async () => {});
      const childPlugin = vi.fn(async () => {});
      app.group('/api', { plugins: [parentPlugin] }, (g) => {
        g.group('/v1', { plugins: [childPlugin] }, (v1) => {
          v1.route({
            method: 'GET',
            path: '/health',
            handler: async (_r, res) => res.send({}),
          });
        });
      });
      const req = makeReq({ path: '/api/v1/health' });
      const res = makeRes();
      await app.handle(req, res);
      expect(parentPlugin).toHaveBeenCalledOnce();
      expect(childPlugin).toHaveBeenCalledOnce();
    });

    it('throws when no callback provided', () => {
      const app = new Axiomify();
      expect(() => (app as any).group('/bad', {})).toThrow();
    });
  });

  describe('healthCheck', () => {
    it('returns status ok for default health check', async () => {
      const app = new Axiomify();
      app.healthCheck('/health');
      const route = app.registeredRoutes.find((r) => r.path === '/health')!;
      const req = makeReq({ path: '/health' });
      const res = makeRes();
      await route.handler(req, res);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ok', uptime: expect.any(Number) }),
      );
    });

    it('returns degraded status when a check fails', async () => {
      const app = new Axiomify();
      app.healthCheck('/health', {
        db: async () => true,
        cache: async () => false,
      });
      const route = app.registeredRoutes.find((r) => r.path === '/health')!;
      const req = makeReq({ path: '/health' });
      const res = makeRes();
      await route.handler(req, res);
      const [payload] = (res.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(payload.checks.cache).toBe(false);
      expect(payload.status).toBe('degraded');
    });
  });

  describe('module system — Kahn dependency resolution', () => {
    it('resolves modules in dependency order when passed together', () => {
      const app = new Axiomify();
      const order: string[] = [];
      // Register 'a' first so it exists
      app.use({
        name: 'a',
        register: () => {
          order.push('a');
        },
      });
      app.use({
        name: 'b',
        dependencies: ['a'],
        register: () => {
          order.push('b');
        },
      });
      // 'a' registered first → 'b' after
      expect(order).toEqual(['a', 'b']);
    });

    it('throws on missing dependency', () => {
      const app = new Axiomify();
      expect(() =>
        app.use({
          name: 'x',
          dependencies: ['nonexistent'],
          register: () => {},
        }),
      ).toThrow(/nonexistent/);
    });

    it('skips already-registered modules', () => {
      const app = new Axiomify();
      const registerSpy = vi.fn();
      const mod = { name: 'once', register: registerSpy };
      app.use(mod);
      app.use(mod);
      expect(registerSpy).toHaveBeenCalledOnce();
    });
  });

  describe('AppConfigurator (function form)', () => {
    it('calls configurator with app and context', () => {
      const app = new Axiomify();
      const configurator = vi.fn();
      app.use(configurator);
      expect(configurator).toHaveBeenCalledWith(
        app,
        expect.objectContaining({
          provide: expect.any(Function),
          resolve: expect.any(Function),
        }),
      );
    });

    it('context.provide / resolve work', () => {
      const app = new Axiomify();
      app.use((_, ctx) => {
        ctx.provide('key', 'value');
        expect(ctx.resolve<string>('key')).toBe('value');
      });
    });
  });

  describe('default serializer', () => {
    it('produces success envelope when isError is false', () => {
      const app = new Axiomify();
      const out = app.serializer({ data: { id: 1 }, isError: false } as any);
      expect(out).toMatchObject({ status: 'success', data: { id: 1 } });
    });

    it('marks status failed when isError is true', () => {
      const app = new Axiomify();
      const out = app.serializer({ data: null, isError: true } as any);
      expect(out.status).toBe('failed');
    });

    it('marks status failed when statusCode >= 400', () => {
      const app = new Axiomify();
      const out = app.serializer({
        data: null,
        isError: false,
        statusCode: 404,
      } as any);
      expect(out.status).toBe('failed');
    });

    it('uses provided message verbatim', () => {
      const app = new Axiomify();
      const out = app.serializer({
        data: null,
        isError: false,
        message: 'custom',
      } as any);
      expect(out.message).toBe('custom');
    });
  });

  describe('readonly getters', () => {
    it('exposes registeredWsRoutes, router, validator, timeout', () => {
      const app = new Axiomify({ timeout: 1234 });
      expect(Array.isArray(app.registeredWsRoutes)).toBe(true);
      expect(app.router).toBeDefined();
      expect(app.validator).toBeDefined();
      expect(app.timeout).toBe(1234);
    });

    it('timeout defaults to 0', () => {
      expect(new Axiomify().timeout).toBe(0);
    });
  });

  describe('ws registration', () => {
    it('registers a websocket route', () => {
      const app = new Axiomify();
      app.ws({ path: '/ws', handler: async () => {} } as any);
      expect(app.registeredWsRoutes.some((r) => r.path === '/ws')).toBe(true);
    });

    it('throws when registering ws after routes are locked', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN, 'test');
      expect(() =>
        app.ws({ path: '/late', handler: async () => {} } as any),
      ).toThrow(/after the server has started/);
    });
  });

  describe('group.ws', () => {
    it('registers ws route under group prefix', () => {
      const app = new Axiomify();
      app.group('/api', (g) => {
        g.ws({ path: '/socket', handler: async () => {} } as any);
      });
      expect(app.registeredWsRoutes.some((r) => r.path === '/api/socket')).toBe(
        true,
      );
    });
  });

  describe('healthCheck — failure path', () => {
    it('returns degraded when a check throws', async () => {
      const app = new Axiomify();
      app.healthCheck('/h', {
        db: async () => {
          throw new Error('boom');
        },
      });
      const route = app.registeredRoutes.find((r) => r.path === '/h')!;
      const req = makeReq({ path: '/h' });
      const res = makeRes();
      await route.handler(req, res);
      const [payload] = (res.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(payload.checks.db).toBe(false);
      expect(payload.status).toBe('degraded');
    });
  });

  describe('logger', () => {
    it('default logger is defined', () => {
      const app = new Axiomify();
      expect(typeof app.logger.error).toBe('function');
    });

    it('custom logger is returned from getter', () => {
      const logger = { warn: vi.fn(), error: vi.fn() };
      const app = new Axiomify({ logger });
      expect(app.logger).toBe(logger);
    });
  });

  describe('DI Container', () => {
    it('throws when resolving unregistered service', () => {
      const app = new Axiomify();
      expect(() => {
        app.use((_app, context) => {
          context.resolve('unregistered-token');
        });
      }).toThrow(/DI Error: Cannot resolve unregistered service/);
    });
  });

  describe('sortModules', () => {
    it('throws circular dependency error', () => {
      const app = new Axiomify();
      const modA = {
        name: 'modA',
        dependencies: ['modB'],
        register: () => {},
      };
      const modB = {
        name: 'modB',
        dependencies: ['modA'],
        register: () => {},
      };

      const originalSet = Map.prototype.set;
      Map.prototype.set = function (key, val) {
        const res = originalSet.call(this, key, val);
        if (key === 'modA' && val === modA) {
          originalSet.call(this, 'modB', modB);
        }
        return res;
      };

      try {
        expect(() => (app as any)._resolveModuleDeps(modA)).toThrow(
          /Circular dependency detected/,
        );
      } finally {
        Map.prototype.set = originalSet;
      }
    });

    it('topologically sorts modules', () => {
      const app = new Axiomify();
      const modA = {
        name: 'modA',
        dependencies: ['modB'],
        register: () => {},
      };
      const modB = {
        name: 'modB',
        dependencies: [],
        register: () => {},
      };

      const originalSet = Map.prototype.set;
      Map.prototype.set = function (key, val) {
        const res = originalSet.call(this, key, val);
        if (key === 'modA' && val === modA) {
          originalSet.call(this, 'modB', modB);
        }
        return res;
      };

      try {
        const result = (app as any)._resolveModuleDeps(modA);
        expect(result.map((m: any) => m.name)).toEqual(['modB', 'modA']);
      } finally {
        Map.prototype.set = originalSet;
      }
    });
  });

  describe('lockRoutes duplicates', () => {
    it('throws when locked twice', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN, 'adapter-a');
      expect(() => app.lockRoutes(ADAPTER_LOCK_TOKEN, 'adapter-b')).toThrow(
        /has already been called/,
      );
    });
  });

  describe('setSerializer guard', () => {
    it('throws when replacing serializer after routes are locked', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN, 'adapter-a');
      expect(() => app.setSerializer((x) => JSON.stringify(x))).toThrow(
        /Cannot replace serializer after adapter binding/,
      );
    });
  });

  describe('nested group routing without options', () => {
    it('successfully registers nested groups with just a callback', () => {
      const app = new Axiomify();
      app.group('/v1', (g1) => {
        g1.group('/users', (g2) => {
          g2.route({
            method: 'GET',
            path: '/profile',
            handler: async (_r, res) => res.send({ ok: true }),
          });
        });
      });
      const route = app.registeredRoutes.find(
        (r) => r.path === '/v1/users/profile',
      );
      expect(route).toBeDefined();
    });
  });

  // Stack trace guards are removed in favor of object identity (ADAPTER_LOCK_TOKEN) checks.

  describe('locked routes without reason branch', () => {
    it('route() locked error formatting without reason', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN);
      expect(() =>
        app.route({
          method: 'GET',
          path: '/late-no-reason',
          handler: async (_r, res) => res.send({}),
        }),
      ).toThrow(
        /Cannot register route GET \/late-no-reason after adapter binding. Register all routes before/,
      );
    });

    it('setSerializer() locked error formatting without reason', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN);
      expect(() => app.setSerializer((x) => JSON.stringify(x))).toThrow(
        /Cannot replace serializer after adapter binding. Call setSerializer\(\) before/,
      );
    });
  });

  describe('Kahn cycle detection fallback', () => {
    it('covers inDegree.get(n) ?? 0 fallback branch', () => {
      const app = new Axiomify();
      const modA = {
        name: 'modA',
        dependencies: ['modB'],
        register: () => {},
      };
      const modB = {
        name: 'modB',
        dependencies: ['modA'],
        register: () => {},
      };

      const originalSet = Map.prototype.set;
      Map.prototype.set = function (key, val) {
        const res = originalSet.call(this, key, val);
        if (key === 'modA' && val === modA) {
          originalSet.call(this, 'modB', modB);
        }
        return res;
      };

      const originalGet = Map.prototype.get;
      Map.prototype.get = function (key, ...args) {
        if (key === 'modB') {
          const stack = new Error().stack || '';
          if (stack.includes('filter')) {
            return undefined;
          }
        }
        return originalGet.call(this, key, ...args);
      };

      try {
        expect(() => (app as any)._resolveModuleDeps(modA)).toThrow(
          /Circular dependency detected/,
        );
      } finally {
        Map.prototype.set = originalSet;
        Map.prototype.get = originalGet;
      }
    });
  });

  describe('public resolve and vault scope coverage', () => {
    it('throws when public resolve is called with an unregistered token', () => {
      const app = new Axiomify();
      expect(() => app.resolve('unregistered-token' as any)).toThrow(
        /DI Error: Cannot resolve unregistered service "unregistered-token"/,
      );
    });

    it('returns the registered service when token exists', () => {
      const app = new Axiomify();
      app.use((_, context) => {
        context.provide('my-service' as any, { ok: true });
      });
      const result = app.resolve('my-service' as any);
      expect(result).toEqual({ ok: true });
    });

    it('covers vault.scope in AppConfigurator functional context', () => {
      const app = new Axiomify();
      let scopeResult: string = '';
      app.use((_, context) => {
        scopeResult = context.vault.scope('func-module', () => 'func-val');
      });
      expect(scopeResult).toBe('func-val');
    });

    it('covers vault.scope in AppModule topological context', () => {
      const app = new Axiomify();
      let scopeResult: string = '';
      app.use({
        name: 'test-mod',
        register: (_, context) => {
          scopeResult = context.vault.scope('top-module', () => 'top-val');
        },
      });
      expect(scopeResult).toBe('top-val');
    });

    it('seals the vault when lockRoutes is called directly (adapter bootstrap)', () => {
      const app = new Axiomify();
      const mockVault = { seal: vi.fn() };
      app.forceProvide('vault', mockVault);
      app.lockRoutes(ADAPTER_LOCK_TOKEN);
      expect(mockVault.seal).toHaveBeenCalledOnce();
    });
  });
});
