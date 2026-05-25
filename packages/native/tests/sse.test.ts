
import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import http from 'http';

let uwsSupported = false;
try {
  require('uWebSockets.js');
  uwsSupported = true;
} catch {
  uwsSupported = false;
}

describe.skipIf(!uwsSupported)('NativeAdapter - SSE', () => {
  let app: any;
  let adapter: any;
  let PORT: number;

  beforeAll(async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    app = new Axiomify();

    app.route({
      method: 'GET',
      path: '/sse',
      sse: true,
      handler: async (req, res) => {
        res.sseInit?.();
        res.sseSend?.({ hello: 'world' }, 'greet');
      },
    });

    adapter = new NativeAdapter(app, { port: 0 });
    return new Promise<void>((resolve) => {
      adapter.listen((port) => {
        PORT = port;
        resolve();
      });
    });
  });

  afterAll(() => {
    adapter.close();
  });

  it('streams Server-Sent Events', () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${PORT}/sse`, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['cache-control']).toBe('no-cache');

        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
          if (data.includes('event: greet\n') && data.includes('data: {"hello":"world"}\n\n')) {
            req.destroy();
            resolve();
          }
        });

        res.on('end', () => {
          // If connection closes before we get the data, it will time out or we can reject.
        });
      });

      req.on('error', reject);
    });
  });
});
