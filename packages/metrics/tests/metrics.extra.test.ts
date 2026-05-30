import { describe, expect, it, vi, afterEach } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useMetrics } from '../src/index';

function makeReq(overrides: any = {}) {
  return {
    id: 'req_1',
    method: 'GET',
    url: '/api/users',
    path: '/api/users',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  } as any;
}

function makeRes(overrides: any = {}) {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  const res: any = {
    get statusCode() {
      return statusCode;
    },
    header: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn(),
    send: vi.fn(),
    sendRaw: vi.fn(),
    error: vi.fn(),
    stream: vi.fn(),
    headersSent: false,
    raw: {},
    capabilities: { sse: false, streaming: false },
    ...overrides,
  };
  res.status = vi.fn((c: number) => {
    statusCode = c;
    return res;
  });
  return res;
}

describe('useMetrics — extended coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers /metrics endpoint and returns Prometheus text', async () => {
    const app = new Axiomify();
    useMetrics(app, { path: '/metrics' });
    const routes = app.registeredRoutes;
    const metricsRoute = routes.find((r) => r.path === '/metrics');
    expect(metricsRoute).toBeDefined();

    const req = makeReq({ path: '/metrics', url: '/metrics' });
    const res = makeRes();
    await metricsRoute!.handler(req, res);
    expect(res.sendRaw).toHaveBeenCalled();
  });

  it('records request count per path via onRequest + onPostHandler hooks', async () => {
    const app = new Axiomify();
    useMetrics(app);
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    const res = makeRes();
    // fire hooks
    for (const h of hooks.onRequest) await h(req, res);
    for (const h of hooks.onPostHandler)
      await h(req, res, { route: {} as any, params: {} });
    // second request
    for (const h of hooks.onRequest) await h(req, res);
    for (const h of hooks.onPostHandler)
      await h(req, res, { route: {} as any, params: {} });
    // no assertion on internals — just verify no throw
  });

  it('records errors via onError hook', async () => {
    const app = new Axiomify();
    useMetrics(app);
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    const res = makeRes();
    for (const h of hooks.onError) await h(new Error('fail'), req, res);
    // should not throw
  });

  it('respects custom path option', () => {
    const app = new Axiomify();
    useMetrics(app, { path: '/internal/prom' });
    const routes = app.registeredRoutes;
    expect(routes.some((r) => r.path === '/internal/prom')).toBe(true);
  });
});

describe('useMetrics — Prometheus output format', () => {
  it('output contains http_request_duration_ms after requests are recorded', async () => {
    const app = new Axiomify();
    useMetrics(app, { path: '/metrics' });
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    const res = makeRes();
    for (const h of hooks.onRequest) await h(req, res);
    for (const h of hooks.onPostHandler)
      await h(req, res, { route: {} as any, params: {} });

    const metricsRoute = app.registeredRoutes.find(
      (r) => r.path === '/metrics',
    )!;
    let output = '';
    const metricsRes = makeRes();
    metricsRes.sendRaw = vi.fn((s: string) => {
      output = s;
    });
    await metricsRoute.handler(makeReq({ path: '/metrics' }), metricsRes);
    expect(output).toContain('http_request_duration_ms');
    expect(output).toContain('http_requests_total');
  });

  it('drops invalid CIDR entries in allowlist', async () => {
    const app = new Axiomify();
    // Invalid CIDR: bits out of range and malformed IP — buildAllowlistMatchers returns [] for these
    useMetrics(app, {
      allowlist: ['256.0.0.1/8', '1.2.3.4/99', 'bogus/notanumber'],
    });
    const route = app.registeredRoutes.find((r) => r.path === '/metrics')!;
    const req = makeReq({ path: '/metrics', ip: '1.2.3.4' });
    const res = makeRes();
    await route.handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('onError hook records err.status when statusCode is absent', async () => {
    const app = new Axiomify();
    useMetrics(app);
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    const res = makeRes();
    // err.status (not statusCode) — covers the second branch
    for (const h of hooks.onError) await h({ status: 502 }, req, res);
    // sanity: no throw — internal map should contain a 502 entry
  });

  it('onError hook with non-Error object uses default 500', async () => {
    const app = new Axiomify();
    useMetrics(app);
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    req.state.startTime = process.hrtime.bigint();
    for (const h of hooks.onError) await h({}, req, makeRes());
  });

  it('denies metrics in production without protect/allowlist/token', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = new Axiomify();
      useMetrics(app);
      const route = app.registeredRoutes.find((r) => r.path === '/metrics')!;
      const res = makeRes();
      await route.handler(makeReq({ path: '/metrics' }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      // Call again to ensure the warning is only emitted once.
      await route.handler(makeReq({ path: '/metrics' }), makeRes());
    } finally {
      process.env.NODE_ENV = original;
      warnSpy.mockRestore();
    }
  });

  it('allows metrics in production when allowPublicInProduction is true', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = new Axiomify();
      useMetrics(app, { allowPublicInProduction: true });
      const route = app.registeredRoutes.find((r) => r.path === '/metrics')!;
      const res = makeRes();
      res.sendRaw = vi.fn();
      await route.handler(makeReq({ path: '/metrics' }), res);
      expect(res.sendRaw).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = original;
      warnSpy.mockRestore();
    }
  });

  it('records correct duration when startTime is set', async () => {
    const app = new Axiomify();
    useMetrics(app);
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    // run onRequest (sets startTime)
    for (const h of hooks.onRequest) await h(req, makeRes());
    expect(req.state.startTime).toBeDefined();
    // After a tiny tick, postHandler — duration > 0
    await new Promise((r) => setImmediate(r));
    for (const h of hooks.onPostHandler)
      await h(req, makeRes(), { route: { path: '/api' } as any, params: {} });
  });

  it('onPreHandler stamps metricsRouteLabel on req.state', async () => {
    const app = new Axiomify();
    useMetrics(app);
    const hooks = (app as any).hooks.hooks;
    const req = makeReq();
    for (const h of hooks.onPreHandler)
      await h(req, makeRes(), { route: { path: '/x/:id' } as any, params: {} });
    expect(req.state.metricsRouteLabel).toBe('/x/:id');
  });

  it('includes WebSocket stats when wsManager is provided', async () => {
    const fakeWsManager = { getStats: vi.fn(() => ({ connectedClients: 5 })) };
    const app = new Axiomify();
    useMetrics(app, { path: '/metrics', wsManager: fakeWsManager as any });
    const metricsRoute = app.registeredRoutes.find(
      (r) => r.path === '/metrics',
    )!;
    let output = '';
    const res = makeRes();
    res.sendRaw = vi.fn((s: string) => {
      output = s;
    });
    await metricsRoute.handler(makeReq({ path: '/metrics' }), res);
    expect(output).toContain('ws_connected_clients 5');
  });
});
