import { Axiomify } from '@axiomify/core';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyAdapter } from '../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function request(
  port: number,
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr
            ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            data: data ? JSON.parse(data) : {},
            headers: res.headers as Record<string, string>,
          }),
        );
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main integration suite
// ---------------------------------------------------------------------------

describe('FastifyAdapter: routing via Fastify router', () => {
  let adapter: FastifyAdapter;
  let port: number;

  beforeAll(async () => {
    const app = new Axiomify();

    app.route({
      method: 'GET',
      path: '/users',
      handler: async (_req, res) => res.send([{ id: 1 }]),
    });

    app.route({
      method: 'POST',
      path: '/users',
      handler: async (req, res) => res.status(201).send(req.body),
    });

    app.route({
      method: 'GET',
      path: '/users/:id',
      handler: async (req, res) => res.send({ id: req.params }),
    });

    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => res.send(req.body),
    });

    adapter = new FastifyAdapter(app);
    // Use the underlying Fastify instance to bind on an ephemeral port.
    const nativeApp = (adapter as any).app;
    const address = await nativeApp.listen({ port: 0 });
    const match = /:(\d+)$/.exec(address);
    port = Number(match![1]);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it('routes GET /users using Fastify router — returns 200', async () => {
    const res = await request(port, '/users', 'GET');
    expect(res.status).toBe(200);
    expect(res.data.data).toEqual([{ id: 1 }]);
  });

  it('routes GET /users/:id — Fastify populates req.params', async () => {
    const res = await request(port, '/users/99', 'GET');
    expect(res.status).toBe(200);
    // The Fastify adapter passes req.params directly to handleMatchedRoute
    expect(res.data.data.id).toMatchObject({ id: '99' });
  });

  it('routes POST /echo — parses JSON body', async () => {
    const res = await request(port, '/echo', 'POST', { hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.data.data).toEqual({ hello: 'world' });
  });

  it('returns 404 for unregistered path', async () => {
    const res = await request(port, '/nonexistent', 'GET');
    expect(res.status).toBe(404);
  });

  it('returns 405 with Allow header for registered path with wrong method', async () => {
    const res = await request(port, '/users', 'DELETE');
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toContain('GET');
    expect(res.headers['allow']).toContain('POST');
  });

  it('includes X-Request-Id on every response via onRequest hook', async () => {
    const res = await request(port, '/users', 'GET');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('strips __proto__ from JSON body (prototype pollution guard)', async () => {
    await request(port, '/echo', 'POST', { __proto__: { polluted: true } });
    expect(({} as any).polluted).toBeUndefined();
  });

  it('strips constructor and prototype keys from body', async () => {
    const res = await request(port, '/echo', 'POST', {
      safe: 'yes',
      constructor: { bad: true },
      prototype: { bad: true },
    });
    expect(res.data.data).toEqual({ safe: 'yes' });
  });
});

// ---------------------------------------------------------------------------
// Body size enforcement
// ---------------------------------------------------------------------------

describe('FastifyAdapter: body size limit enforcement', () => {
  let adapter: FastifyAdapter;
  let port: number;

  beforeAll(async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => res.send(req.body),
    });
    adapter = new FastifyAdapter(app, { bodyLimit: 1024 });
    const nativeApp = (adapter as any).app;
    const address = await nativeApp.listen({ port: 0 });
    const match = /:(\d+)$/.exec(address);
    port = Number(match![1]);
  });

  afterAll(async () => adapter.close());

  it('accepts bodies under the 1 KB limit', async () => {
    const res = await request(port, '/echo', 'POST', { small: 'payload' });
    expect(res.status).toBe(200);
  });

  it('rejects bodies over the 1 KB limit with 413', async () => {
    const large = { data: 'x'.repeat(2048) };
    const res = await request(port, '/echo', 'POST', large);
    expect(res.status).toBe(413);
  });
});
