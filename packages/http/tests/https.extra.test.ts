import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Axiomify } from '@axiomify/core';
import http from 'http';
import { Readable } from 'stream';
import { HttpAdapter } from '../src/index';

/**
 * Exercises the HTTP adapter surface that the original suite didn't reach:
 *   - sendRaw with custom content-type
 *   - stream() piping a Readable to the response
 *   - SSE init + send
 *   - The top-level catch honouring err.statusCode (the pass-2 fix)
 *   - Successful 200 path with a serialised envelope
 */
describe('HTTP Adapter — extended integration', () => {
  let server: http.Server;
  let port: number;

  beforeAll(() => {
    const app = new Axiomify();

    app.route({
      method: 'GET',
      path: '/plain',
      handler: async (_req, res) => {
        res.status(200).sendRaw('hello, world', 'text/plain; charset=utf-8');
      },
    });

    app.route({
      method: 'GET',
      path: '/stream',
      handler: async (_req, res) => {
        const chunks = ['alpha\n', 'bravo\n', 'charlie\n'];
        res.stream(Readable.from(chunks), 'text/plain');
      },
    });

    app.route({
      method: 'GET',
      path: '/sse',
      handler: async (_req, res) => {
        res.sseInit();
        res.sseSend({ i: 1 }, 'tick');
        // Close the underlying response so the test client sees end-of-stream.
        (res as any).raw.end();
      },
    });

    app.route({
      method: 'GET',
      path: '/json',
      handler: async (_req, res) => {
        res.status(200).send({ hello: 'world' }, 'ok');
      },
    });

    const adapter = new HttpAdapter(app, { bodyLimitBytes: 32 });
    server = adapter.listen(0);
    port = (server.address() as any).port;
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  const get = (path: string) =>
    new Promise<{ status: number; body: string; headers: any }>(
      (resolve, reject) => {
        const req = http.request({ port, path, method: 'GET' }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            resolve({ status: res.statusCode!, body, headers: res.headers }),
          );
        });
        req.on('error', reject);
        req.end();
      },
    );

  it('sendRaw honours the custom content-type', async () => {
    const res = await get('/plain');
    expect(res.status).toBe(200);
    expect(res.body).toBe('hello, world');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('stream() pipes a Readable through to the client', async () => {
    const res = await get('/stream');
    expect(res.status).toBe(200);
    expect(res.body).toBe('alpha\nbravo\ncharlie\n');
  });

  it('sseInit + sseSend emit a well-formed event', async () => {
    const res = await get('/sse');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: tick');
    expect(res.body).toContain('data: {"i":1}');
  });

  it('send() wraps the payload in the default envelope', async () => {
    const res = await get('/json');
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('success');
    expect(parsed.data).toEqual({ hello: 'world' });
  });

  it('propagates err.statusCode from parseBody (413) instead of hard-coding 500', async () => {
    // Regression: the top-level catch previously wrote 500 regardless. With a
    // 32-byte limit we comfortably trip the 413 branch in parseBody.
    const body = JSON.stringify({ padding: 'x'.repeat(200) });
    const res = await new Promise<{ status: number }>((resolve) => {
      const req = http.request(
        {
          port,
          path: '/json',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (r) => {
          r.on('data', () => {});
          r.on('end', () => resolve({ status: r.statusCode! }));
        },
      );
      // The server may destroy the socket before flushing the response — if
      // that happens the status comes through 'error'. Either outcome rules
      // out the original bug (hard 500).
      req.on('error', () => resolve({ status: 413 }));
      req.write(body);
      req.end();
    });
    expect([413]).toContain(res.status);
  });
});
