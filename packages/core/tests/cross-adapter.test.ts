/**
 * Cross-adapter parity tests.
 *
 * Every test in this file runs against ALL adapters via describe.each.
 * If a behaviour differs across adapters, that is a bug.
 *
 * Adapters under test: @axiomify/http, @axiomify/express, @axiomify/fastify,
 * @axiomify/hapi
 *
 * NOTE: @axiomify/native is excluded because it requires uWebSockets.js binaries
 * that may not be available on all test environments (ABI-specific). Native
 * behaviour is covered by packages/native/tests/native.test.ts.
 */
import { Axiomify } from '@axiomify/core';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// ─── Adapter factory type ─────────────────────────────────────────────────────

interface AdapterHarness {
  name: string;
  setup(app: Axiomify): Promise<{ port: number; teardown: () => Promise<void> }>;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function req(
  port: number,
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const method = opts.method ?? 'GET';
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const r = http.request(
      {
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let body: unknown;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode!, body, headers: res.headers as Record<string, string> });
        });
      },
    );
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

// ─── Adapter harnesses ────────────────────────────────────────────────────────

const ADAPTERS: AdapterHarness[] = [
  {
    name: '@axiomify/http',
    async setup(app) {
      const { HttpAdapter } = await import('@axiomify/http');
      const adapter = new HttpAdapter(app);
      const server = adapter.listen(0);
      await new Promise<void>((r) => server.once('listening', r));
      const port = (server.address() as { port: number }).port;
      return { port, teardown: () => adapter.close() };
    },
  },
  {
    name: '@axiomify/express',
    async setup(app) {
      const { ExpressAdapter } = await import('@axiomify/express');
      const adapter = new ExpressAdapter(app);
      return new Promise((resolve) => {
        const server = adapter.listen(0, () => {
          const port = (server.address() as { port: number }).port;
          resolve({ port, teardown: () => adapter.close() });
        });
      });
    },
  },
  {
    name: '@axiomify/fastify',
    async setup(app) {
      const { FastifyAdapter } = await import('@axiomify/fastify');
      const adapter = new FastifyAdapter(app);
      const nativeApp = (adapter as unknown as { app: { listen: (o: object) => Promise<string> } }).app;
      const address = await nativeApp.listen({ port: 0 });
      const port = parseInt(/:(\d+)$/.exec(address)![1]);
      return { port, teardown: () => adapter.close() };
    },
  },
  {
    name: '@axiomify/hapi',
    async setup(app) {
      const { HapiAdapter } = await import('@axiomify/hapi');
      const adapter = new HapiAdapter(app);
      const native = (adapter as unknown as { server: import('@hapi/hapi').Server }).server;
      native.settings.port = 0;
      await native.start();
      const port = native.info.port as number;
      return { port, teardown: () => adapter.close() };
    },
  },
];

// ─── Parity test suite ────────────────────────────────────────────────────────

describe.each(ADAPTERS)('Cross-adapter parity — $name', ({ setup }) => {
  let port: number;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const app = new Axiomify();
    // X-Request-Id is opt-in — enable it for the cross-adapter parity suite.
    app.enableRequestId();

    // GET /ping — simple JSON response
    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (_r, res) => res.send({ pong: true }),
    });

    // GET /users/:id — param extraction
    app.route({
      method: 'GET',
      path: '/users/:id',
      handler: async (r, res) => res.send({ id: r.params.id }),
    });

    // POST /echo — body round-trip + Zod validation
    app.route({
      method: 'POST',
      path: '/echo',
      schema: { body: z.object({ name: z.string(), age: z.number() }) },
      handler: async (r, res) => res.send(r.body),
    });

    // GET /query — query string parsing
    app.route({
      method: 'GET',
      path: '/query',
      handler: async (r, res) => res.send({ q: r.query }),
    });

    // DELETE /items/:id — 204 No Content
    app.route({
      method: 'DELETE',
      path: '/items/:id',
      handler: async (_r, res) => res.status(204).send(null),
    });

    ({ port, teardown } = await setup(app));
  });

  afterAll(async () => teardown());

  // ── Routing ──────────────────────────────────────────────────────────────────

  it('GET /ping → 200 with envelope { status, message, data }', async () => {
    const r = await req(port, '/ping');
    expect(r.status).toBe(200);
    expect((r.body as any).data).toEqual({ pong: true });
    expect((r.body as any).status).toBe('success');
  });

  it('GET /users/:id → extracts named param correctly', async () => {
    const r = await req(port, '/users/42');
    expect(r.status).toBe(200);
    expect((r.body as any).data.id).toBe('42');
  });

  it('GET /nonexistent → 404', async () => {
    const r = await req(port, '/nonexistent');
    expect(r.status).toBe(404);
  });

  it('DELETE /ping → 405 with Allow header', async () => {
    const r = await req(port, '/ping', { method: 'DELETE' });
    expect(r.status).toBe(405);
    expect(r.headers['allow']).toMatch(/GET/);
  });

  it('DELETE /items/:id → 204', async () => {
    const r = await req(port, '/items/5', { method: 'DELETE' });
    expect(r.status).toBe(204);
  });

  // ── Validation ────────────────────────────────────────────────────────────────

  it('POST /echo with valid body → 200 and echoes parsed data', async () => {
    const r = await req(port, '/echo', {
      method: 'POST',
      body: { name: 'Ada', age: 37 },
    });
    expect(r.status).toBe(200);
    expect((r.body as any).data).toMatchObject({ name: 'Ada', age: 37 });
  });

  it('POST /echo with invalid body → 400 with validation errors', async () => {
    const r = await req(port, '/echo', {
      method: 'POST',
      body: { name: 'Ada', age: 'not-a-number' },
    });
    expect(r.status).toBe(400);
  });

  it('POST /echo with missing body → 400', async () => {
    const r = await req(port, '/echo', { method: 'POST', body: {} });
    expect(r.status).toBe(400);
  });

  // ── Response envelope ─────────────────────────────────────────────────────────

  it('X-Request-Id header present on every response', async () => {
    const r = await req(port, '/ping');
    expect(r.headers['x-request-id']).toBeTruthy();
  });

  it('Error responses use status: "failed" envelope', async () => {
    const r = await req(port, '/nonexistent');
    expect((r.body as any).status).toBe('failed');
  });

  // ── Security ──────────────────────────────────────────────────────────────────

  it('Prototype pollution via __proto__ body does not mutate Object.prototype', async () => {
    await req(port, '/echo', {
      method: 'POST',
      body: { __proto__: { polluted: true }, name: 'Ada', age: 37 },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  // ── Query strings ─────────────────────────────────────────────────────────────

  it('Query string is parsed and available on req.query', async () => {
    const r = await req(port, '/query?search=hello&page=1');
    expect(r.status).toBe(200);
    const q = (r.body as any).data.q;
    expect(q.search).toBe('hello');
    expect(q.page).toBe('1');
  });
});
