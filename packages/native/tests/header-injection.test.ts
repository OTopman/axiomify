/**
 * Regression test for CRLF / NUL injection in response headers.
 *
 * Background: an HTTP header value containing CR or LF lets an attacker
 * split the response, injecting a fully-forged second response or arbitrary
 * cookies. Frameworks have shipped this vulnerability repeatedly (Express's
 * Set-Cookie split, Fastify's pre-v3 header bug, etc). uWS does not validate
 * header values, so NativeResponse.header() MUST reject the dangerous bytes.
 *
 * This test runs without uWS (mocked) so it works on every Node version
 * the project supports.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('uWebSockets.js', () => ({
  default: {
    App: () => ({
      get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(),
      del: vi.fn(), options: vi.fn(), head: vi.fn(), any: vi.fn(),
      ws: vi.fn(),
      listen: vi.fn((_p: number, cb: (t: unknown) => void) => cb({})),
    }),
    SHARED_COMPRESSOR: 0,
    us_listen_socket_close: vi.fn(),
    us_socket_local_port: vi.fn(() => 3000),
  },
}));

function makeResponse() {
  // Smallest viable NativeResponse-like setup. We instantiate via the
  // adapter so the real header() implementation is exercised.
  return (async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const app = new Axiomify();
    let captured: any = null;
    app.route({
      method: 'GET',
      path: '/h',
      handler: (_req, res) => { captured = res; res.send({}); },
    });
    const adapter = new NativeAdapter(app, { port: 0 });
    adapter.listen();
    // Pull the registered uWS callback and invoke it with a fake req/res.
    const uWS = (await import('uWebSockets.js')).default as any;
    const lastServer = (uWS.App as any).mock?.results?.slice(-1)?.[0]?.value
      ?? (adapter as any)._server;
    const getRegistered = lastServer.get.mock.calls[0]?.[1];
    if (!getRegistered) throw new Error('handler not registered');
    const fakeReq = {
      getUrl: () => '/h',
      getQuery: () => '',
      getParameter: () => '',
      forEach: () => {},
      getHeader: () => '',
    };
    const fakeRes = {
      onAborted: vi.fn(),
      onData: vi.fn(),
      cork: (cb: () => void) => cb(),
      writeStatus: vi.fn(),
      writeHeader: vi.fn(),
      end: vi.fn(),
      getRemoteAddressAsText: () => new ArrayBuffer(0),
      getProxiedRemoteAddressAsText: () => new ArrayBuffer(0),
    };
    getRegistered(fakeRes, fakeReq);
    // Yield once so the IIFE runs.
    await new Promise((r) => setImmediate(r));
    return { res: captured, fakeRes };
  })();
}

describe('NativeResponse.header() — header injection prevention', () => {
  it('throws when header VALUE contains CR', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Foo', 'bar\rSet-Cookie: pwned=1'))
      .toThrow(/response splitting/i);
  });

  it('throws when header VALUE contains LF', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Foo', 'bar\nSet-Cookie: pwned=1'))
      .toThrow(/response splitting/i);
  });

  it('throws when header VALUE contains CRLF', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Foo', 'bar\r\nSet-Cookie: pwned=1'))
      .toThrow(/response splitting/i);
  });

  it('throws when header VALUE contains NUL', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Foo', 'bar\0baz'))
      .toThrow(/response splitting/i);
  });

  it('throws when header KEY contains CRLF', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Foo\r\nEvil', 'bar'))
      .toThrow(/response splitting/i);
  });

  it('accepts normal header values unchanged', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Request-Id', 'abc-123')).not.toThrow();
    expect(res.getHeader('X-Request-Id')).toBe('abc-123');
  });

  it('accepts values with tabs and printable ASCII (RFC 9110 field-vchar)', async () => {
    const { res } = await makeResponse();
    expect(() => res.header('X-Foo', 'multi word value\twith tab')).not.toThrow();
  });
});
