/**
 * Regression test: the `requestTimeout` (504) fast path must flush any
 * cookies already queued via `res.cookie()` before a slow handler trips
 * the timeout.
 *
 * Previously this path wrote the cached 504 status/headers/body directly
 * on the raw uWS response object, bypassing `NativeResponse`'s
 * `_writeCookies()` entirely — a handler that called `res.cookie(...)` and
 * then hung past `requestTimeout` got a 504 with the queued Set-Cookie
 * silently dropped.
 *
 * Runs without uWS (mocked) so it works on every Node version the project
 * supports — same pattern as header-injection.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('uWebSockets.js', () => ({
  default: {
    App: () => ({
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      options: vi.fn(),
      head: vi.fn(),
      any: vi.fn(),
      ws: vi.fn(),
      listen: vi.fn((_host: string, _p: number, cb: (t: unknown) => void) =>
        cb({}),
      ),
    }),
    SHARED_COMPRESSOR: 0,
    us_listen_socket_close: vi.fn(),
    us_socket_local_port: vi.fn(() => 3000),
  },
}));

function makeFakeReq() {
  return {
    getUrl: () => '/slow',
    getQuery: () => '',
    getParameter: () => '',
    forEach: () => {},
    getHeader: () => '',
  };
}

function makeFakeRes() {
  return {
    onAborted: vi.fn(),
    onData: vi.fn(),
    cork: (cb: () => void) => cb(),
    writeStatus: vi.fn(),
    writeHeader: vi.fn(),
    end: vi.fn(),
    getRemoteAddressAsText: () => new ArrayBuffer(0),
    getProxiedRemoteAddressAsText: () => new ArrayBuffer(0),
  };
}

describe('requestTimeout — cookie flushing on the 504 fast path', () => {
  it('flushes a cookie queued via res.cookie() before the handler ever responds', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');

    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/slow',
      handler: (_req, res) => {
        // Queue a cookie, then hang forever — the handler never calls
        // send()/sendRaw(), so `headersSent` stays false until the
        // requestTimeout branch fires.
        res.cookie!('session', 'abc123', { httpOnly: true });
        return new Promise<void>(() => {});
      },
    });

    const adapter = new NativeAdapter(app, { port: 0, requestTimeout: 20 });
    adapter.listen();

    const uWS = (await import('uWebSockets.js')).default as any;
    const lastServer =
      (uWS.App as any).mock?.results?.slice(-1)?.[0]?.value ??
      (adapter as any)._server;
    const getRegistered = lastServer.get.mock.calls[0]?.[1];
    if (!getRegistered) throw new Error('handler not registered');

    const fakeRes = makeFakeRes();
    getRegistered(fakeRes, makeFakeReq());

    // Let the async dispatch IIFE run far enough to invoke the handler
    // (which queues the cookie) before the timeout has any chance to fire.
    await new Promise((r) => setImmediate(r));

    // Real delay past requestTimeout — avoids fake-timer interaction with
    // the setImmediate/microtask scheduling the dispatch path depends on.
    await new Promise((r) => setTimeout(r, 60));

    expect(fakeRes.writeStatus).toHaveBeenCalledWith(
      expect.stringContaining('504'),
    );
    const setCookieCalls = fakeRes.writeHeader.mock.calls.filter(
      ([name]: [string]) => name === 'Set-Cookie',
    );
    expect(setCookieCalls).toHaveLength(1);
    expect(setCookieCalls[0][1]).toContain('session=abc123');
  });
});
