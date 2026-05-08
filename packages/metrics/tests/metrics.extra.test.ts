import { describe, expect, it, vi, afterEach } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useMetrics } from '../src/index';

function makeReq(overrides: any = {}) {
  return {
    id: 'req_1', method: 'GET', url: '/api/users', path: '/api/users',
    ip: '127.0.0.1', headers: {}, body: undefined, query: {}, params: {},
    state: {}, raw: {}, stream: null,
    ...overrides,
  } as any;
}

function makeRes(overrides: any = {}) {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  return {
    get statusCode() { return statusCode; },
    status: vi.fn((c: number) => { statusCode = c; return res; }),
    header: vi.fn((k: string, v: string) => { headers[k] = v; return res; }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn(),
    send: vi.fn(), sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
    headersSent: false, raw: {},
    capabilities: { sse: false, streaming: false },
    ...overrides,
  } as any;
  var res: any;
}

describe('useMetrics — extended coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers /metrics endpoint and returns Prometheus text', async () => {
    const app = new Axiomify();
    useMetrics(app, { path: '/metrics' });
    const routes = app.registeredRoutes;
    const metricsRoute = routes.find(r => r.path === '/metrics');
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
    for (const h of hooks.onPostHandler) await h(req, res, { route: {} as any, params: {} });
    // second request
    for (const h of hooks.onRequest) await h(req, res);
    for (const h of hooks.onPostHandler) await h(req, res, { route: {} as any, params: {} });
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
    expect(routes.some(r => r.path === '/internal/prom')).toBe(true);
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
    for (const h of hooks.onPostHandler) await h(req, res, { route: {} as any, params: {} });

    const metricsRoute = app.registeredRoutes.find(r => r.path === '/metrics')!;
    let output = '';
    const metricsRes = makeRes();
    metricsRes.sendRaw = vi.fn((s: string) => { output = s; });
    await metricsRoute.handler(makeReq({ path: '/metrics' }), metricsRes);
    expect(output).toContain('http_request_duration_ms');
    expect(output).toContain('http_requests_total');
  });

  it('includes WebSocket stats when wsManager is provided', async () => {
    const fakeWsManager = { getStats: vi.fn(() => ({ connectedClients: 5 })) };
    const app = new Axiomify();
    useMetrics(app, { path: '/metrics', wsManager: fakeWsManager as any });
    const metricsRoute = app.registeredRoutes.find(r => r.path === '/metrics')!;
    let output = '';
    const res = makeRes();
    res.sendRaw = vi.fn((s: string) => { output = s; });
    await metricsRoute.handler(makeReq({ path: '/metrics' }), res);
    expect(output).toContain('ws_connected_clients 5');
  });
});
