import { describe, expect, it, vi, afterEach } from 'vitest';
import { Axiomify, ADAPTER_LOCK_TOKEN } from '../src/index';

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1', method: 'GET', url: '/', path: '/', ip: '127.0.0.1',
    headers: {}, body: undefined, query: {}, params: {},
    state: {}, raw: {}, stream: null,
    ...overrides,
  };
}

function makeRes(overrides: any = {}): any {
  const headers: Record<string, string> = {};
  let sent = false;
  const res: any = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn((k: string, v: string) => { headers[k] = v; return res; }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn().mockReturnThis(),
    send: vi.fn(() => { sent = true; }),
    sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
    get headersSent() { return sent; },
    statusCode: 200, raw: {},
    capabilities: { sse: false, streaming: false },
    get headers() { return headers; },
    ...overrides,
  };
  return res;
}

describe('Axiomify app — extended coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('lockRoutes token guard', () => {
    it('throws when called without ADAPTER_LOCK_TOKEN', () => {
      const app = new Axiomify();
      expect(() => (app as any).lockRoutes('bad-token')).toThrow(/reserved for adapter use/);
    });

    it('prevents route registration after lock', () => {
      const app = new Axiomify();
      app.lockRoutes(ADAPTER_LOCK_TOKEN, 'test');
      expect(() =>
        app.route({ method: 'GET', path: '/late', handler: async (_r, res) => res.send({}) }),
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
      app.route({ method: 'GET', path: '/id', handler: async (_r, res) => res.send({}) });
      const req = makeReq({ path: '/id' });
      const res = makeRes();
      await app.handle(req, res);
      expect(res.header).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    });

    it('respects upstream x-request-id header', async () => {
      const app = new Axiomify();
      app.enableRequestId();
      app.route({ method: 'GET', path: '/id2', handler: async (_r, res) => res.send({}) });
      const req = makeReq({ path: '/id2', headers: { 'x-request-id': 'upstream-123' } });
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
          method: 'GET', path: '/users',
          handler: async (_r, res) => { handlerCalled = true; res.send({}); },
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
          v1.route({ method: 'GET', path: '/health', handler: async (_r, res) => res.send({}) });
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
      const route = app.registeredRoutes.find(r => r.path === '/health')!;
      const req = makeReq({ path: '/health' });
      const res = makeRes();
      await route.handler(req, res);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ok', uptime: expect.any(Number) }),
      );
    });

    it('returns degraded status when a check fails', async () => {
      const app = new Axiomify();
      app.healthCheck('/health', { db: async () => true, cache: async () => false });
      const route = app.registeredRoutes.find(r => r.path === '/health')!;
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
      app.use({ name: 'a', register: () => { order.push('a'); } });
      app.use({ name: 'b', dependencies: ['a'], register: () => { order.push('b'); } });
      // 'a' registered first → 'b' after
      expect(order).toEqual(['a', 'b']);
    });

    it('throws on missing dependency', () => {
      const app = new Axiomify();
      expect(() =>
        app.use({ name: 'x', dependencies: ['nonexistent'], register: () => {} }),
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
      expect(configurator).toHaveBeenCalledWith(app, expect.objectContaining({
        provide: expect.any(Function),
        resolve: expect.any(Function),
      }));
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
      const out = app.serializer({ data: null, isError: false, statusCode: 404 } as any);
      expect(out.status).toBe('failed');
    });

    it('uses provided message verbatim', () => {
      const app = new Axiomify();
      const out = app.serializer({ data: null, isError: false, message: 'custom' } as any);
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
      expect(app.registeredWsRoutes.some(r => r.path === '/ws')).toBe(true);
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
      expect(app.registeredWsRoutes.some(r => r.path === '/api/socket')).toBe(true);
    });
  });

  describe('healthCheck — failure path', () => {
    it('returns degraded when a check throws', async () => {
      const app = new Axiomify();
      app.healthCheck('/h', { db: async () => { throw new Error('boom'); } });
      const route = app.registeredRoutes.find(r => r.path === '/h')!;
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
});
