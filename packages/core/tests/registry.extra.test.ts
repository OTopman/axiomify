/**
 * Extra RouteRegistry coverage:
 * - timeout path (AbortSignal)
 * - telemetry span start/end
 * - pipeline direct-handler fast path
 */
import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/index';

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
  let sent = false;
  const res: any = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
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
    ...overrides,
  };
  return res;
}

describe('RouteRegistry — extended coverage', () => {
  it('fast path (no timeout/telemetry): calls handler directly', async () => {
    const app = new Axiomify({ timeout: 0 });
    let called = false;
    app.route({
      method: 'GET',
      path: '/fast',
      handler: async (_r, res) => {
        called = true;
        res.send({});
      },
    });
    const req = makeReq({ path: '/fast' });
    const res = makeRes();
    await app.handle(req, res);
    expect(called).toBe(true);
  });

  it('timeout path: throws 408 when handler exceeds timeout', async () => {
    const app = new Axiomify({ timeout: 10 });
    app.route({
      method: 'GET',
      path: '/slow',
      handler: async (_r, res) => {
        await new Promise((r) => setTimeout(r, 200));
        res.send({});
      },
    });
    const req = makeReq({ path: '/slow' });
    const res = makeRes();
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(408);
  });

  it('per-route timeout overrides global timeout', async () => {
    const app = new Axiomify({ timeout: 5_000 });
    app.route({
      method: 'GET',
      path: '/fast-override',
      timeout: 10,
      handler: async (_r, res) => {
        await new Promise((r) => setTimeout(r, 200));
        res.send({});
      },
    });
    const req = makeReq({ path: '/fast-override' });
    const res = makeRes();
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(408);
  });

  it('telemetry: startSpan called and span.end() called after handler', async () => {
    const spanEnd = vi.fn();
    const startSpan = vi.fn(() => ({ end: spanEnd }));
    const app = new Axiomify({ telemetry: { startSpan } });
    app.route({
      method: 'GET',
      path: '/traced',
      handler: async (_r, res) => res.send({}),
    });
    const req = makeReq({ path: '/traced' });
    const res = makeRes();
    await app.handle(req, res);
    expect(startSpan).toHaveBeenCalledWith('http.request', {
      method: 'GET',
      path: '/traced',
    });
    expect(spanEnd).toHaveBeenCalled();
  });

  it('registerWs: tracks ws route and compiles message schema', async () => {
    const { z } = await import('zod');
    const app = new Axiomify();
    app.ws({
      path: '/chat',
      schema: { message: z.object({ text: z.string() }) },
      handler: async () => {},
    } as any);
    expect(app.registeredWsRoutes).toHaveLength(1);
    expect(app.registeredWsRoutes[0].path).toBe('/chat');
  });

  it('registerWs without schema also works', () => {
    const app = new Axiomify();
    app.ws({ path: '/p', handler: async () => {} } as any);
    expect(app.registeredWsRoutes).toHaveLength(1);
  });

  it('telemetry span.end() called even when handler throws', async () => {
    const spanEnd = vi.fn();
    const startSpan = vi.fn(() => ({ end: spanEnd }));
    const app = new Axiomify({ telemetry: { startSpan } });
    app.route({
      method: 'GET',
      path: '/traced-throw',
      handler: async () => {
        throw new Error('oops');
      },
    });
    const req = makeReq({ path: '/traced-throw' });
    const res = makeRes();
    await app.handle(req, res);
    expect(spanEnd).toHaveBeenCalled();
  });
});
