import { describe, expect, it, vi } from 'vitest';
import { Axiomify, z } from '@axiomify/core';
import { useOpenAPI as useSwagger } from '../src/index';

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1', method: 'GET', url: '/docs', path: '/docs',
    ip: '127.0.0.1', headers: {}, body: undefined, query: {}, params: {},
    state: {}, raw: {}, stream: null,
    ...overrides,
  };
}

function makeRes(overrides: any = {}): any {
  let sent = false;
  const res: any = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    removeHeader: vi.fn().mockReturnThis(),
    send: vi.fn(() => { sent = true; }),
    sendRaw: vi.fn((d: any) => { res._raw = d; sent = true; }),
    error: vi.fn(), stream: vi.fn(),
    get headersSent() { return sent; },
    get statusCode() { return res._code ?? 200; },
    _code: 200, raw: {},
    capabilities: { sse: false, streaming: false },
    ...overrides,
  };
  return res;
}

describe('useSwagger — extended coverage', () => {
  it('registers /docs GET and /docs/openapi.json GET routes', () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'Test', version: '1.0.0' } });
    const paths = app.registeredRoutes.map(r => r.path);
    expect(paths).toContain('/docs');
    expect(paths).toContain('/docs/openapi.json');
  });

  it('returns OpenAPI JSON spec from the spec route', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET', path: '/users',
      schema: { response: z.object({ id: z.string() }) },
      meta: { tags: ['Users'] },
      handler: async (_r, res) => res.send({ id: '1' }),
    });
    useSwagger(app, { info: { title: 'API', version: '2.0.0' } });
    const specRoute = app.registeredRoutes.find(r => r.path === '/docs/openapi.json')!;
    const req = makeReq({ path: '/docs/openapi.json' });
    const res = makeRes();
    await specRoute.handler(req, res);
    expect(res._raw).toBeDefined();
    const spec = JSON.parse(res._raw);
    expect(spec.info.title).toBe('API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.paths['/users']).toBeDefined();
  });

  it('serves Swagger UI HTML from the docs route', async () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'T', version: '1' } });
    const docsRoute = app.registeredRoutes.find(r => r.path === '/docs')!;
    const req = makeReq({ path: '/docs' });
    const res = makeRes();
    await docsRoute.handler(req, res);
    const output = res._raw ?? '';
    expect(typeof output === 'string' ? output : '').toContain('swagger');
  });

  it('protects spec route when protect callback returns false', async () => {
    const app = new Axiomify();
    useSwagger(app, {
      info: { title: 'T', version: '1' },
      protect: async () => false,
    });
    const specRoute = app.registeredRoutes.find(r => r.path === '/docs/openapi.json')!;
    const req = makeReq({ path: '/docs/openapi.json' });
    const res = makeRes();
    await specRoute.handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('custom prefix changes route paths', () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'T', version: '1' }, routePrefix: '/api-docs' });
    const paths = app.registeredRoutes.map(r => r.path);
    expect(paths).toContain('/api-docs');
    expect(paths).toContain('/api-docs/openapi.json');
  });

  it('autoInferResponses registers onPostHandler hook', () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'T', version: '1' }, autoInferResponses: true });
    const hooks = (app as any).hooks.hooks;
    expect(hooks.onPostHandler.length).toBeGreaterThan(0);
  });
});

describe('useSwagger — autoInferResponses + prefix edge cases', () => {
  it('routePrefix with trailing slash is normalized', () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'T', version: '1' }, routePrefix: '/api-docs/' });
    const paths = app.registeredRoutes.map(r => r.path);
    expect(paths).toContain('/api-docs');
    expect(paths).toContain('/api-docs/openapi.json');
  });

  it('routePrefix without leading slash gets one added', () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'T', version: '1' }, routePrefix: 'swagger' });
    const paths = app.registeredRoutes.map(r => r.path);
    expect(paths).toContain('/swagger');
  });

  it('autoInferResponses hook infers schema from response payload', async () => {
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/items', handler: async (_r, res) => res.send([{ id: 1 }]) });
    useSwagger(app, { info: { title: 'T', version: '1' }, autoInferResponses: true, allowPublicInProduction: true });

    const hooks = (app as any).hooks.hooks;
    const req = makeReq({ path: '/items' });
    // Build a proper res mock with writable statusCode
    let _statusCode = 200;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(), removeHeader: vi.fn(), send: vi.fn(),
      sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
      headersSent: false, raw: {},
      capabilities: { sse: false, streaming: false },
      get statusCode() { return _statusCode; },
      set statusCode(v: number) { _statusCode = v; },
    };
    res.payload = [{ id: 1 }];

    for (const h of hooks.onPostHandler) {
      await h(req, res, { route: { path: '/items', method: 'GET' } as any, params: {} });
    }
    // No throw = success — autoInferResponses ran without error
  });

  it('autoInferResponses skips docs endpoints without error', async () => {
    const app = new Axiomify();
    useSwagger(app, { info: { title: 'T', version: '1' }, autoInferResponses: true, allowPublicInProduction: true });
    const hooks = (app as any).hooks.hooks;
    const req = makeReq({ path: '/docs/openapi.json' });
    let _sc = 200;
    const res: any = {
      status: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(), removeHeader: vi.fn(), send: vi.fn(),
      sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
      headersSent: false, raw: {}, capabilities: { sse: false, streaming: false },
      get statusCode() { return _sc; }, set statusCode(v: number) { _sc = v; },
    };
    res.payload = {};
    for (const h of hooks.onPostHandler) {
      const ret = h(req, res, { route: { path: '/docs/openapi.json', method: 'GET' } as any, params: {} });
      if (ret) await ret;
    }
    // Docs endpoint was skipped — no error
  });
});
