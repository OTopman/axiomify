import http from 'http';
import { describe, expect, it } from 'vitest';

// ─── No double routing (uses handleMatchedRoute, not handle) ──────────────────

describe('HttpAdapter — routing via handleMatchedRoute (no double routing)', () => {
  it('resolves the route once and calls handleMatchedRoute — never core.handle', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { HttpAdapter } = await import('../src/index');

    const app = new Axiomify();
    let handleMatchedCalls = 0;
    let handleCalls = 0;

    const origHandleMatched = app.handleMatchedRoute.bind(app);
    app.handleMatchedRoute = async (...args: Parameters<typeof origHandleMatched>) => {
      handleMatchedCalls++;
      return origHandleMatched(...args);
    };
    const origHandle = app.handle.bind(app);
    app.handle = async (...args: Parameters<typeof origHandle>) => {
      handleCalls++;
      return origHandle(...args);
    };

    app.route({ method: 'GET', path: '/ping', handler: async (_req, res) => res.send({ ok: true }) });

    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;

    await new Promise<void>((resolve, reject) => {
      http.get(`http://localhost:${port}/ping`, (res) => {
        res.on('data', () => {});
        res.on('end', () => { resolve(); });
      }).on('error', reject);
    });

    await adapter.close();

    expect(handleMatchedCalls).toBe(1); // route was matched and dispatched once
    expect(handleCalls).toBe(0);        // core.handle (double routing) was NEVER called
  });

  it('returns 404 for unknown paths', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { HttpAdapter } = await import('../src/index');
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/known', handler: async (_req, res) => res.send({ ok: true }) });

    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };

    const status = await new Promise<number>((resolve, reject) => {
      http.get(`http://localhost:${port}/unknown`, (res) => { resolve(res.statusCode!); }).on('error', reject);
    });

    await adapter.close();
    expect(status).toBe(404);
  });

  it('returns 405 with Allow header for wrong method', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { HttpAdapter } = await import('../src/index');
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/only-get', handler: async (_req, res) => res.send({ ok: true }) });

    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };

    const result = await new Promise<{ status: number; allow: string }>((resolve, reject) => {
      const req = http.request({ port, path: '/only-get', method: 'DELETE' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode!, allow: res.headers['allow'] ?? '' }));
      });
      req.on('error', reject);
      req.end();
    });

    await adapter.close();
    expect(result.status).toBe(405);
    expect(result.allow).toContain('GET');
  });

  it('validates Zod body schema and returns parsed data', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { HttpAdapter } = await import('../src/index');
    const { z } = await import('zod');
    const app = new Axiomify();

    app.route({
      method: 'POST',
      path: '/echo',
      schema: { body: z.object({ name: z.string(), age: z.number() }) },
      handler: async (req, res) => res.send(req.body),
    });

    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };

    const bodyStr = JSON.stringify({ name: 'Ada', age: 37 });
    const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = http.request(
        { port, path: '/echo', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    await adapter.close();
    expect(result.status).toBe(200);
    expect((result.body as any).data).toMatchObject({ name: 'Ada', age: 37 });
  });

  it('returns 400 when Zod validation fails on body', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { HttpAdapter } = await import('../src/index');
    const { z } = await import('zod');
    const app = new Axiomify();

    app.route({
      method: 'POST',
      path: '/strict',
      schema: { body: z.object({ count: z.number() }) },
      handler: async (req, res) => res.send(req.body),
    });

    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };

    const bodyStr = JSON.stringify({ count: 'not-a-number' });
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { port, path: '/strict', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
        (res) => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode!)); },
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    await adapter.close();
    expect(status).toBe(400);
  });

  it('listenClustered is defined and callable', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { HttpAdapter } = await import('../src/index');
    const app = new Axiomify();
    app.route({ method: 'GET', path: '/ping', handler: async (_req, res) => res.send({ ok: true }) });
    const adapter = new HttpAdapter(app);
    expect(typeof adapter.listenClustered).toBe('function');
  });
});
