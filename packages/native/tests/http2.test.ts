import { execSync } from 'child_process';
import fs from 'fs';
import http2 from 'node:http2';
import { Readable } from 'node:stream';
import https from 'node:https';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The Http2Adapter is built on node:http2 — it never touches uWebSockets.js,
// so unlike the NativeAdapter suites these tests need NO uWS gating. Importing
// from '../src/http2' (not '../src/index') keeps the uWS binary out of the
// module graph entirely, so the suite runs on every platform Node supports.
import { Http2Adapter } from '../src/http2';

// ---------------------------------------------------------------------------
// h2 client helper (cleartext / h2c)
// ---------------------------------------------------------------------------

interface H2Result {
  status: number;
  headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader;
  body: string;
}

function h2Request(
  port: number,
  opts: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
): Promise<H2Result> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`http://127.0.0.1:${port}`);
    client.once('error', (err) => reject(err));

    const req = client.request({
      ':method': opts.method ?? 'GET',
      ':path': opts.path ?? '/',
      ...(opts.headers ?? {}),
    });

    let status = 0;
    let headers: H2Result['headers'] = {};
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      client.close();
      if (status === 0) {
        reject(new Error('h2 stream closed before a response arrived'));
      } else {
        resolve({ status, headers, body: Buffer.concat(chunks).toString() });
      }
    };

    req.on('response', (h) => {
      headers = h;
      status = h[':status'] as number;
    });
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', finish);
    req.on('close', finish);
    // A 413 flush-then-destroy tears the stream down server-side; if the
    // response already arrived, surface it instead of the RST error.
    req.on('error', () => finish());

    if (opts.body !== undefined) req.end(opts.body);
    else req.end();
  });
}

// ---------------------------------------------------------------------------
// h2c suite — the full adapter surface over cleartext HTTP/2
// ---------------------------------------------------------------------------

describe('Http2Adapter (h2c)', () => {
  let adapter: Http2Adapter;
  let PORT: number;
  // Paths whose request lifecycle fully closed — for streaming/SSE routes the
  // dispatcher wires res.onStreamClose to the onClose hooks, and the adapter
  // must invoke it after the stream actually ends (isStreaming contract).
  const closedPaths: string[] = [];

  beforeAll(async () => {
    const { Axiomify, z } = await import('@axiomify/core');
    const app = new Axiomify();
    app.addHook('onClose', (req: any) => {
      closedPaths.push(req.path);
    });

    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (_req: any, res: any) => {
        res.send({ message: 'pong' });
      },
    });

    // Zod query coercion
    app.route({
      method: 'GET',
      path: '/coerce',
      schema: {
        query: z.object({ n: z.coerce.number(), flag: z.coerce.boolean() }),
      },
      handler: async (req: any, res: any) => {
        res.send({
          n: req.query.n,
          nType: typeof req.query.n,
          flag: req.query.flag,
        });
      },
    });

    // POST with JSON body + Zod validation
    app.route({
      method: 'POST',
      path: '/data',
      schema: { body: z.object({ key: z.string() }) },
      handler: async (req: any, res: any) => {
        res.send({ received: req.body.key });
      },
    });

    // Request cookie parsing + multiple Set-Cookie response lines
    app.route({
      method: 'GET',
      path: '/cookies',
      handler: async (req: any, res: any) => {
        res.cookie('session', 'abc123', { httpOnly: true, path: '/' });
        res.cookie('theme', 'dark');
        res.send({ got: req.cookies });
      },
    });

    // Host derivation from :authority
    app.route({
      method: 'GET',
      path: '/host',
      handler: async (req: any, res: any) => {
        res.send({ host: req.headers.host, hasPseudo: ':path' in req.headers });
      },
    });

    // 204 null-body status
    app.route({
      method: 'GET',
      path: '/no-content',
      handler: async (_req: any, res: any) => {
        res.status(204).send(null);
      },
    });

    // Streaming
    app.route({
      method: 'GET',
      path: '/stream',
      handler: async (_req: any, res: any) => {
        res.stream(Readable.from(['hello ', 'h2 ', 'world']), 'text/plain');
      },
    });

    // SSE
    app.route({
      method: 'GET',
      path: '/sse',
      sse: true,
      handler: async (_req: any, res: any) => {
        res.sseInit?.();
        res.sseSend?.({ hello: 'h2' }, 'greet');
        res.sseSend?.('plain line');
      },
    });

    // sendRaw
    app.route({
      method: 'GET',
      path: '/raw',
      handler: async (_req: any, res: any) => {
        res.header('X-Custom', 'yes');
        res.sendRaw('<h1>hi</h1>', 'text/html');
      },
    });

    // Raw body echo — no Zod schema, so req.body reflects exactly what the
    // adapter's own body-parsing produced (regression coverage for the
    // empty-body req.body divergence from NativeAdapter).
    app.route({
      method: 'POST',
      path: '/echo-body',
      handler: async (req: any, res: any) => {
        res.send({ bodyType: typeof req.body, body: req.body });
      },
    });

    adapter = new Http2Adapter(app, { h2c: true, port: 0, maxBodySize: 256 });
    PORT = await new Promise<number>((resolve) => {
      adapter.listen((port) => resolve(port));
    });
  });

  afterAll(() => {
    adapter.close();
  });

  it('handles a basic GET over HTTP/2', async () => {
    const res = await h2Request(PORT, { path: '/ping' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({
      status: 'success',
      message: 'Operation successful',
      data: { message: 'pong' },
    });
  });

  it('coerces query params through the Zod schema', async () => {
    const res = await h2Request(PORT, { path: '/coerce?n=42&flag=true' });
    expect(res.status).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(data.n).toBe(42);
    expect(data.nType).toBe('number');
    expect(data.flag).toBe(true);
  });

  it('validates POST JSON bodies', async () => {
    const res = await h2Request(PORT, {
      method: 'POST',
      path: '/data',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data).toEqual({ received: 'value' });
  });

  it('returns a 400 envelope for invalid bodies', async () => {
    const res = await h2Request(PORT, {
      method: 'POST',
      path: '/data',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 123 }),
    });
    expect(res.status).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('failed');
    // ValidationError carries structured field errors in the data slot.
    expect(parsed.data).toBeTruthy();
    expect(JSON.stringify(parsed)).toContain('key');
  });

  it('parses an empty urlencoded body to {} — matching NativeAdapter, not undefined', async () => {
    // Regression: body-parsing used to be skipped entirely for a
    // zero-length body, leaving req.body as `undefined`. NativeAdapter
    // always calls parseBodyBuffer, which turns an empty urlencoded body
    // into `{}` — a handler relying on that (e.g. `req.body.foo`) must not
    // crash only under Http2Adapter for the identical request.
    const res = await h2Request(PORT, {
      method: 'POST',
      path: '/echo-body',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.bodyType).toBe('object');
    expect(data.body).toEqual({});
  });

  it('parses an empty JSON body the same way as a non-empty one (undefined, unparsed)', async () => {
    const res = await h2Request(PORT, {
      method: 'POST',
      path: '/echo-body',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.bodyType).toBe('undefined');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await h2Request(PORT, { path: '/nope' });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).message).toBe('Route not found');
  });

  it('rejects oversized bodies with 413 (declared Content-Length)', async () => {
    const big = 'x'.repeat(1024);
    const res = await h2Request(PORT, {
      method: 'POST',
      path: '/data',
      headers: {
        'content-type': 'application/json',
        'content-length': String(big.length),
      },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it('rejects oversized bodies with 413 (streamed, no Content-Length)', async () => {
    const res = await h2Request(PORT, {
      method: 'POST',
      path: '/data',
      headers: { 'content-type': 'application/json' },
      body: 'y'.repeat(4096),
    });
    expect(res.status).toBe(413);
  });

  it('emits multiple Set-Cookie lines and parses request cookies', async () => {
    const res = await h2Request(PORT, {
      path: '/cookies',
      headers: { cookie: 'a=1; b=2' },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);
    expect(setCookie).toHaveLength(2);
    expect(setCookie![0]).toContain('session=abc123');
    expect(setCookie![0]).toContain('HttpOnly');
    expect(setCookie![1]).toContain('theme=dark');
    expect(JSON.parse(res.body).data.got).toEqual({ a: '1', b: '2' });
  });

  it('suppresses the body on HEAD while keeping headers', async () => {
    const res = await h2Request(PORT, { method: 'HEAD', path: '/ping' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body).toBe('');
  });

  it('strips pseudo-headers and maps :authority to host', async () => {
    const res = await h2Request(PORT, { path: '/host' });
    const { data } = JSON.parse(res.body);
    expect(data.host).toBe(`127.0.0.1:${PORT}`);
    expect(data.hasPseudo).toBe(false);
  });

  it('sends 204 with no body', async () => {
    const res = await h2Request(PORT, { path: '/no-content' });
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
  });

  it('streams a Readable and fires onStreamClose after end', async () => {
    const res = await h2Request(PORT, { path: '/stream' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.body).toBe('hello h2 world');
    // The adapter must fire onStreamClose (→ onClose hooks) after stream end.
    await new Promise((r) => setTimeout(r, 20));
    expect(closedPaths).toContain('/stream');
  });

  it('sends raw payloads with custom headers', async () => {
    const res = await h2Request(PORT, { path: '/raw' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.headers['x-custom']).toBe('yes');
    expect(res.body).toBe('<h1>hi</h1>');
  });

  it('delivers SSE frames over an h2 stream', async () => {
    await new Promise<void>((resolve, reject) => {
      const client = http2.connect(`http://127.0.0.1:${PORT}`);
      client.once('error', reject);
      const req = client.request({ ':method': 'GET', ':path': '/sse' });
      let data = '';
      req.on('response', (h) => {
        expect(h[':status']).toBe(200);
        expect(h['content-type']).toBe('text/event-stream');
        expect(h['cache-control']).toBe('no-cache');
      });
      req.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (
          data.includes('event: greet\n') &&
          data.includes('data: {"hello":"h2"}\n\n') &&
          data.includes('data: plain line\n\n')
        ) {
          req.close();
          client.close();
          resolve();
        }
      });
      req.on('error', reject);
      req.end();
    });
    // Client disconnect aborts the request signal → onStreamClose (→ onClose
    // hooks) fires for the SSE stream.
    await new Promise((r) => setTimeout(r, 50));
    expect(closedPaths).toContain('/sse');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — graceful close semantics
// ---------------------------------------------------------------------------

describe('Http2Adapter lifecycle', () => {
  it('close() drains in-flight requests and refuses new connections', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/slow',
      handler: async (_req: any, res: any) => {
        await new Promise((r) => setTimeout(r, 150));
        res.send({ done: true });
      },
    });

    const adapter = new Http2Adapter(app, { h2c: true, port: 0 });
    const port = await new Promise<number>((resolve) => {
      adapter.listen((p) => resolve(p));
    });

    const inflight = h2Request(port, { path: '/slow' });
    // Let the request reach the handler before closing.
    await new Promise((r) => setTimeout(r, 40));
    adapter.close();

    // GOAWAY lets the in-flight stream finish...
    const res = await inflight;
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data).toEqual({ done: true });

    // ...but new connections are refused.
    await expect(h2Request(port, { path: '/slow' })).rejects.toThrow();
  });

  it('throws a clear error when neither tls nor h2c is configured', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const app = new Axiomify();
    expect(() => new Http2Adapter(app)).toThrow(/requires TLS/);
  });

  it('warns when trustProxy is enabled without a proxyIpValidator', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const app = new Axiomify();
    const warnings: string[] = [];
    const adapter = new Http2Adapter(app, {
      h2c: true,
      trustProxy: true,
      logger: {
        warn: (msg) => warnings.push(msg),
        error: () => {},
      },
    });
    adapter.close();
    expect(warnings.some((w) => w.includes('proxyIpValidator'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TLS / ALPN — h2 over TLS with transparent http/1.1 fallback
// ---------------------------------------------------------------------------

describe('Http2Adapter TLS + ALPN', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const keyPath = path.resolve(fixturesDir, 'h2-key.pem');
  const certPath = path.resolve(fixturesDir, 'h2-cert.pem');
  let adapter: Http2Adapter;
  let PORT: number;

  beforeAll(async () => {
    fs.mkdirSync(fixturesDir, { recursive: true });
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
          `-days 1 -nodes -subj "/CN=localhost" ` +
          `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
        { stdio: 'ignore' },
      );
    } catch {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
          `-days 1 -nodes -subj "/CN=localhost"`,
        { stdio: 'ignore' },
      );
    }

    const { Axiomify } = await import('@axiomify/core');
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/secure',
      handler: async (req: any, res: any) => {
        res.send({
          httpVersion: req.raw.req.httpVersion,
          alpn: (req.raw.req.socket as any).alpnProtocol ?? null,
        });
      },
    });

    // Exercises the keyFile/certFile path (inline key/cert is type-level only).
    adapter = new Http2Adapter(app, {
      port: 0,
      tls: { keyFile: keyPath, certFile: certPath },
    });
    PORT = await new Promise<number>((resolve) => {
      adapter.listen((p) => resolve(p));
    });
  });

  afterAll(() => {
    adapter?.close();
    if (fs.existsSync(keyPath)) fs.rmSync(keyPath, { force: true });
    if (fs.existsSync(certPath)) fs.rmSync(certPath, { force: true });
  });

  it('negotiates h2 via ALPN', async () => {
    const ca = fs.readFileSync(certPath);
    const result = await new Promise<H2Result>((resolve, reject) => {
      const client = http2.connect(`https://localhost:${PORT}`, { ca });
      client.once('error', reject);
      const req = client.request({ ':method': 'GET', ':path': '/secure' });
      let status = 0;
      const chunks: Buffer[] = [];
      req.on('response', (h) => {
        status = h[':status'] as number;
      });
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        client.close();
        resolve({
          status,
          headers: {},
          body: Buffer.concat(chunks).toString(),
        });
      });
      req.on('error', reject);
      req.end();
    });
    expect(result.status).toBe(200);
    const data = JSON.parse(result.body).data;
    expect(data.alpn).toBe('h2');
    expect(data.httpVersion).toBe('2.0');
  });

  it('falls back to HTTP/1.1 for non-h2 clients on the same port', async () => {
    const ca = fs.readFileSync(certPath);
    const result = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = https.request(
          `https://localhost:${PORT}/secure`,
          // Plain https client — negotiates http/1.1 via ALPN.
          { ca },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 0, body }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    expect(result.status).toBe(200);
    // Served through the HTTP/1.1 compatibility path on the same port.
    expect(JSON.parse(result.body).data.httpVersion).toBe('1.1');
  });

  it('throws a clear error for an unreadable key file', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const app = new Axiomify();
    expect(
      () =>
        new Http2Adapter(app, {
          tls: { keyFile: '/nonexistent/key.pem', certFile: certPath },
        }),
    ).toThrow(/could not read the TLS private key/);
  });
});
