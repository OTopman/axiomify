import { describe, expect, it, vi, afterEach } from 'vitest';
import * as http from 'http';
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '../src/index';

async function withAdapter(
  app: Axiomify,
  opts: ConstructorParameters<typeof HttpAdapter>[1] = {},
  fn: (server: http.Server, adapter: HttpAdapter) => Promise<void>,
): Promise<void> {
  const adapter = new HttpAdapter(app, opts);
  const server = adapter.listen(0);
  await new Promise<void>(r => server.once('listening', r));
  try {
    await fn(server, adapter);
  } finally {
    await adapter.close();
  }
}

async function makeReq(
  server: http.Server,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port: addr.port, method, path, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function basicApp() {
  const app = new Axiomify();
  app.route({ method: 'GET', path: '/ping', handler: async (_r, res) => res.send({ ok: true }) });
  app.route({ method: 'POST', path: '/echo', handler: async (r, res) => res.send(r.body) });
  return app;
}

describe('HttpAdapter — body parsing and routing', () => {
  it('parses JSON body', async () => {
    await withAdapter(basicApp(), {}, async (server) => {
      const b = JSON.stringify({ name: 'Ada' });
      const res = await makeReq(server, 'POST', '/echo', b, {
        'content-type': 'application/json',
        'content-length': String(b.length),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).data).toMatchObject({ name: 'Ada' });
    });
  });

  it('rejects oversized body with 413', async () => {
    await withAdapter(basicApp(), { bodyLimitBytes: 10 }, async (server) => {
      const b = JSON.stringify({ data: 'x'.repeat(100) });
      const res = await makeReq(server, 'POST', '/echo', b, {
        'content-type': 'application/json',
        'content-length': String(b.length),
      });
      expect(res.status).toBe(413);
    });
  });

  it('returns 200 for GET /ping', async () => {
    await withAdapter(basicApp(), {}, async (server) => {
      const res = await makeReq(server, 'GET', '/ping');
      expect(res.status).toBe(200);
    });
  });

  it('returns 404 for unknown routes', async () => {
    await withAdapter(basicApp(), {}, async (server) => {
      const res = await makeReq(server, 'GET', '/nope');
      expect(res.status).toBe(404);
    });
  });

  it('returns 405 for wrong method', async () => {
    await withAdapter(basicApp(), {}, async (server) => {
      const res = await makeReq(server, 'DELETE', '/ping');
      expect(res.status).toBe(405);
    });
  });

  it('trustProxy: uses X-Forwarded-For for req.ip', async () => {
    let ip = '';
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/ip', handler: async (r, res) => { ip = r.ip; res.send({ ip }); } });
    await withAdapter(app, { trustProxy: true }, async (server) => {
      await makeReq(server, 'GET', '/ip', undefined, { 'x-forwarded-for': '203.0.113.5' });
      expect(ip).toBe('203.0.113.5');
    });
  });

  it('listen() returns an http.Server', () => {
    const app = basicApp();
    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    expect(server).toBeInstanceOf(http.Server);
    adapter.close();
  });
});
