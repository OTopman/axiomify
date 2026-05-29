/**
 * Tests for the Express/Connect compatibility bridge.
 *
 * The bridge polyfills enough of Node's `IncomingMessage` /
 * `ServerResponse` to run a narrow class of middleware (cors, helmet,
 * basic-auth, header-only logging). It deliberately does NOT polyfill
 * the streaming body / chunked-write surface — middleware that needs
 * those is unsafe inside the native adapter and would silently corrupt
 * `req.body` if we faked it.
 *
 * These tests pin the *fail-fast* behaviour. The original 4.x bridge
 * silently emitted a `Buffer.from(JSON.stringify(req.body))` chunk to
 * any `req.on('data', ...)` listener, which let middleware like
 * body-parser appear to work while actually double-parsing the already-
 * decoded body. The new behaviour throws loudly so the bug surfaces
 * at integration time instead of three weeks later in production.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createNodeReqPolyfill,
  createNodeResPolyfill,
  adaptMiddleware,
} from '../src/bridge';

function mockAxiomifyReq() {
  return {
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    url: '/x',
    ip: '127.0.0.1',
    body: { hello: 'world' },
  } as any;
}

function mockAxiomifyRes() {
  const calls: { fn: string; args: unknown[] }[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  return {
    calls,
    get statusCode() { return statusCode; },
    status(c: number) { statusCode = c; calls.push({ fn: 'status', args: [c] }); return this; },
    header(k: string, v: string) { headers[k] = v; calls.push({ fn: 'header', args: [k, v] }); return this; },
    getHeader(k: string) { return headers[k]; },
    removeHeader(k: string) { delete headers[k]; calls.push({ fn: 'removeHeader', args: [k] }); return this; },
    sendRaw(payload: unknown, contentType?: string) { calls.push({ fn: 'sendRaw', args: [payload, contentType] }); },
    send(data: unknown, message?: string) { calls.push({ fn: 'send', args: [data, message] }); },
    error(err: unknown) { calls.push({ fn: 'error', args: [err] }); },
    stream() {},
    get headersSent() { return calls.some((c) => c.fn === 'sendRaw' || c.fn === 'send'); },
    raw: {},
    capabilities: { sse: false, streaming: true },
  } as any;
}

describe('bridge.createNodeReqPolyfill — fail-fast on body stream access', () => {
  it('exposes headers / method / url / ip / socket', () => {
    const nodeReq = createNodeReqPolyfill(mockAxiomifyReq());
    expect(nodeReq.headers).toEqual({ 'content-type': 'application/json' });
    expect(nodeReq.method).toBe('POST');
    expect(nodeReq.url).toBe('/x');
    expect(nodeReq.originalUrl).toBe('/x');
    expect(nodeReq.ip).toBe('127.0.0.1');
    expect((nodeReq.socket as { remoteAddress: string }).remoteAddress).toBe('127.0.0.1');
    expect((nodeReq.connection as { remoteAddress: string }).remoteAddress).toBe('127.0.0.1');
  });

  it('THROWS on req.on("data") — pins the fail-fast regression', () => {
    const nodeReq = createNodeReqPolyfill(mockAxiomifyReq());
    expect(() => (nodeReq.on as any)('data', () => {})).toThrow(
      /Express middleware attempted to consume the request body stream/,
    );
  });

  it('THROWS on req.on("end") for the same reason', () => {
    const nodeReq = createNodeReqPolyfill(mockAxiomifyReq());
    expect(() => (nodeReq.on as any)('end', () => {})).toThrow(
      /Express middleware attempted to consume the request body stream/,
    );
  });
});

describe('bridge.createNodeResPolyfill — header / status / end mapping', () => {
  it('proxies statusCode through res.status()', () => {
    const res = mockAxiomifyRes();
    const nodeRes = createNodeResPolyfill(res);
    (nodeRes as any).statusCode = 418;
    expect(res.calls.find((c: any) => c.fn === 'status')).toEqual({ fn: 'status', args: [418] });
    expect((nodeRes as any).statusCode).toBe(418);
  });

  it('setHeader / getHeader / removeHeader all delegate', () => {
    const res = mockAxiomifyRes();
    const nodeRes = createNodeResPolyfill(res);
    (nodeRes.setHeader as any)('X-Foo', 'bar');
    expect((nodeRes.getHeader as any)('X-Foo')).toBe('bar');
    (nodeRes.removeHeader as any)('X-Foo');
    expect((nodeRes.getHeader as any)('X-Foo')).toBeUndefined();
  });

  it('setHeader coalesces string[] into a comma-separated string', () => {
    const res = mockAxiomifyRes();
    const nodeRes = createNodeResPolyfill(res);
    (nodeRes.setHeader as any)('Cache-Control', ['public', 'max-age=60']);
    expect((nodeRes.getHeader as any)('Cache-Control')).toBe('public, max-age=60');
  });

  it('end(chunk) routes to sendRaw with the configured Content-Type', () => {
    const res = mockAxiomifyRes();
    const nodeRes = createNodeResPolyfill(res);
    (nodeRes.setHeader as any)('Content-Type', 'text/html');
    (nodeRes.end as any)('<h1>hi</h1>');
    expect(res.calls.find((c: any) => c.fn === 'sendRaw')).toEqual({
      fn: 'sendRaw',
      args: ['<h1>hi</h1>', 'text/html'],
    });
  });

  it('end() with no chunk still calls sendRaw with an empty body', () => {
    const res = mockAxiomifyRes();
    const nodeRes = createNodeResPolyfill(res);
    (nodeRes.end as any)();
    const call = res.calls.find((c: any) => c.fn === 'sendRaw');
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe('');
  });

  it('THROWS on res.write() — chunked writes must go through res.stream() instead', () => {
    const res = mockAxiomifyRes();
    const nodeRes = createNodeResPolyfill(res);
    expect(() => (nodeRes.write as any)('partial')).toThrow(
      /Chunked writes via res\.write\(\) are not supported/,
    );
  });
});

describe('bridge.adaptMiddleware — warnings on unsafe middleware', () => {
  it('logs warning when JSON body parser middleware is adapted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    function jsonParser(req: any, res: any, next: any) {}

    adaptMiddleware(jsonParser);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Bridging middleware "jsonParser" may be unsafe')
    );

    warnSpy.mockRestore();
  });
});
