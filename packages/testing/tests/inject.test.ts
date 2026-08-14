import { Axiomify } from '@axiomify/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestClient } from '../src/index';

describe('createTestClient — request/response round-trips', () => {
  it('GET round-trip returns the production envelope', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (_req, res) => res.send({ pong: true }),
    });

    const res = await createTestClient(app).get('/ping');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.json()).toEqual({
      status: 'success',
      message: 'Operation successful',
      data: { pong: true },
    });
    expect(res.data).toEqual({ pong: true });
    expect(res.body).toBe(JSON.stringify(res.json()));
  });

  it('POST round-trip with Zod body validation and object auto-JSON', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/users',
      schema: {
        body: z.object({ name: z.string(), age: z.number().default(30) }),
        response: z.object({ name: z.string(), age: z.number() }),
      },
      handler: async (req, res) => {
        res.status(201).send(req.body);
      },
    });

    const res = await createTestClient(app).post('/users', {
      body: { name: 'Ada' },
    });
    expect(res.statusCode).toBe(201);
    // .default(30) applied by the validation pipeline
    expect(res.data).toEqual({ name: 'Ada', age: 30 });
    expect(res.json<{ status: string }>().status).toBe('success');
  });

  it('coerces query strings to schema-declared types', async () => {
    const app = new Axiomify();
    let seen: unknown;
    app.route({
      method: 'GET',
      path: '/items',
      schema: {
        query: z.object({
          limit: z.number(),
          active: z.boolean(),
          page: z.number().default(1),
        }),
      },
      handler: async (req, res) => {
        seen = req.query;
        res.send(req.query);
      },
    });

    const res = await createTestClient(app).inject({
      method: 'GET',
      url: '/items?limit=5&active=true',
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual({ limit: 5, active: true, page: 1 });
  });

  it('parses multi-value query keys as arrays and merges the query option', async () => {
    const app = new Axiomify();
    let seen: any;
    app.route({
      method: 'GET',
      path: '/search',
      handler: async (req, res) => {
        seen = req.query;
        res.send(null);
      },
    });

    await createTestClient(app).inject({
      method: 'GET',
      url: '/search?tag=a&tag=b',
      query: { tag: 'c', limit: 5, deep: ['x', 'y'] },
    });
    expect(seen.tag).toEqual(['a', 'b', 'c']);
    expect(seen.limit).toBe('5');
    expect(seen.deep).toEqual(['x', 'y']);
  });

  it('extracts path params', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/users/:id',
      schema: { params: z.object({ id: z.number() }) },
      handler: async (req, res) => res.send({ id: (req.params as any).id }),
    });

    const res = await createTestClient(app).get('/users/42');
    expect(res.data).toEqual({ id: 42 });
  });

  it('returns 404 for unknown paths', async () => {
    const app = new Axiomify();
    const res = await createTestClient(app).get('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      status: 'failed',
      message: 'Route not found',
      data: null,
    });
  });

  it('returns 405 with an Allow header for known path, wrong method', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/only-get',
      handler: async (_req, res) => res.send(null),
    });

    const res = await createTestClient(app).post('/only-get', { body: {} });
    expect(res.statusCode).toBe(405);
    // GET routes also serve HEAD, so the router advertises it.
    expect(res.headers['allow']).toBe('GET, HEAD, OPTIONS');
    expect(res.json<{ message: string }>().message).toBe('Method Not Allowed');
  });

  it('surfaces the framework validation error shape on invalid body', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/strict',
      schema: { body: z.object({ name: z.string() }) },
      handler: async (_req, res) => res.send(null),
    });

    const res = await createTestClient(app).post('/strict', {
      body: { name: 123 },
    });
    expect(res.statusCode).toBe(400);
    const json = res.json<{ status: string; message: string; data: any }>();
    expect(json.status).toBe('failed');
    expect(json.message).toMatch(/Validation failed/);
    expect(json.data.body).toBeDefined();
    expect(Object.keys(json.data.body).length).toBeGreaterThan(0);
  });

  it('rejects response bodies that violate schema.response (dev mode → 500)', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/broken',
      schema: { response: z.object({ id: z.string() }) },
      handler: async (_req, res) => res.send({ id: 123 } as any),
    });

    const res = await createTestClient(app).get('/broken');
    expect(res.statusCode).toBe(500);
    expect(res.json<{ message: string }>().message).toMatch(
      /Validation failed|Response validation failed/,
    );
  });

  it('suppresses the body for HEAD requests while keeping headers', async () => {
    const app = new Axiomify();
    app.route({
      method: 'HEAD',
      path: '/meta',
      handler: async (_req, res) => {
        res.header('X-Total', '12').send({ hidden: true });
      },
    });

    const res = await createTestClient(app).head('/meta');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-total']).toBe('12');
    expect(res.body).toBe('');
    // The pre-serialization data is still observable for assertions.
    expect(res.data).toEqual({ hidden: true });
  });

  it('applies a custom serializer exactly like production send()', async () => {
    const app = new Axiomify();
    app.setSerializer(({ data, statusCode }) => ({
      ok: (statusCode ?? 200) < 400,
      result: data,
    }));
    app.route({
      method: 'GET',
      path: '/custom',
      handler: async (_req, res) => res.send({ a: 1 }, 'ignored'),
    });

    const res = await createTestClient(app).get('/custom');
    expect(res.json()).toEqual({ ok: true, result: { a: 1 } });
    expect(res.payload).toEqual({ ok: true, result: { a: 1 } });
    expect(res.message).toBe('ignored');
  });

  it('serializes thrown handler errors through the error pipeline', async () => {
    const app = new Axiomify();
    const onError = vi.fn();
    app.addHook('onError', onError);
    app.route({
      method: 'GET',
      path: '/boom',
      handler: async () => {
        throw new Error('boom');
      },
    });

    const res = await createTestClient(app).get('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json<{ status: string; message: string }>()).toMatchObject({
      status: 'failed',
      message: 'boom',
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('honours error statusCode properties (HttpError semantics)', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/teapot',
      handler: async () => {
        const err = new Error('short and stout') as Error & {
          statusCode: number;
        };
        err.statusCode = 418;
        throw err;
      },
    });

    const res = await createTestClient(app).get('/teapot');
    expect(res.statusCode).toBe(418);
    expect(res.json<{ message: string }>().message).toBe('short and stout');
  });

  it('sendRaw() captures raw payloads with the given content type', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/raw',
      handler: async (_req, res) => res.sendRaw('<h1>hi</h1>', 'text/html'),
    });

    const res = await createTestClient(app).get('/raw');
    expect(res.body).toBe('<h1>hi</h1>');
    expect(res.headers['content-type']).toBe('text/html');
  });

  it('sendRaw() stringifies Buffers and non-strings', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/buf',
      handler: async (_req, res) => res.sendRaw(Buffer.from('bytes')),
    });
    app.route({
      method: 'GET',
      path: '/num',
      handler: async (_req, res) => res.sendRaw(42),
    });

    const client = createTestClient(app);
    expect((await client.get('/buf')).body).toBe('bytes');
    expect((await client.get('/num')).body).toBe('42');
  });

  it('res.json() throws a helpful error when the body is not JSON', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/text',
      handler: async (_req, res) => res.sendRaw('plain text'),
    });

    const res = await createTestClient(app).get('/text');
    expect(() => res.json()).toThrow(/failed to parse the response body/);
  });

  it('header injection attempts inside handlers surface as 500s', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/inject',
      handler: async (_req, res) => {
        res.header('X-Bad', 'a\r\nSet-Cookie: pwned=1').send(null);
      },
    });

    const res = await createTestClient(app).get('/inject');
    expect(res.statusCode).toBe(500);
    expect(res.json<{ message: string }>().message).toMatch(/rejected CR\/LF/);
  });

  it('getHeader/removeHeader are case-insensitive on the test response', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/hdr',
      handler: async (_req, res) => {
        res.header('X-One', '1').header('X-Two', '2');
        expect(res.getHeader('x-one')).toBe('1');
        res.removeHeader('X-TWO');
        res.send(null);
      },
    });

    const res = await createTestClient(app).get('/hdr');
    expect(res.headers['x-one']).toBe('1');
    expect(res.headers['x-two']).toBeUndefined();
  });
});

describe('createTestClient — request construction', () => {
  it('lowercases request header names and exposes req.stream', async () => {
    const app = new Axiomify();
    let headerValue: unknown;
    let streamed = '';
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => {
        headerValue = req.headers['x-custom'];
        for await (const chunk of req.stream) streamed += chunk;
        res.send(null);
      },
    });

    await createTestClient(app).post('/echo', {
      headers: { 'X-Custom': 'yes' },
      body: { raw: 1 },
    });
    expect(headerValue).toBe('yes');
    expect(streamed).toBe('{"raw":1}');
  });

  it('parses string bodies as JSON when content-type says so', async () => {
    const app = new Axiomify();
    let seenA: unknown;
    let seenB: unknown;
    let seenBad: unknown;
    app.route({
      method: 'POST',
      path: '/a',
      handler: async (req, res) => {
        seenA = req.body;
        res.send(null);
      },
    });
    app.route({
      method: 'POST',
      path: '/b',
      handler: async (req, res) => {
        seenB = req.body;
        res.send(null);
      },
    });
    app.route({
      method: 'POST',
      path: '/bad',
      handler: async (req, res) => {
        seenBad = req.body;
        res.send(null);
      },
    });

    const client = createTestClient(app);
    await client.post('/a', {
      headers: { 'content-type': 'application/json' },
      body: '{"n":1}',
    });
    await client.post('/b', { body: 'plain string' });
    await client.post('/bad', {
      headers: { 'content-type': ['application/json'] },
      body: '{not json',
    });
    expect(seenA).toEqual({ n: 1 });
    expect(seenB).toBe('plain string');
    expect(seenBad).toBe('{not json'); // malformed JSON passes through verbatim
  });

  it('passes Buffer bodies through untouched', async () => {
    const app = new Axiomify();
    let seen: unknown;
    app.route({
      method: 'POST',
      path: '/bin',
      handler: async (req, res) => {
        seen = req.body;
        res.send(null);
      },
    });

    await createTestClient(app).post('/bin', { body: Buffer.from([1, 2, 3]) });
    expect(Buffer.isBuffer(seen)).toBe(true);
    expect([...(seen as Buffer)]).toEqual([1, 2, 3]);
  });

  it('sets content-length and honours x-request-id / generated ids', async () => {
    const app = new Axiomify();
    const ids: string[] = [];
    let contentLength: unknown;
    app.route({
      method: 'POST',
      path: '/id',
      handler: async (req, res) => {
        ids.push(req.id);
        contentLength = req.headers['content-length'];
        res.send(null);
      },
    });

    const client = createTestClient(app);
    await client.post('/id', {
      headers: { 'X-Request-Id': 'trace-1' },
      body: { a: 1 },
    });
    await client.post('/id', { body: { a: 1 } });
    expect(ids[0]).toBe('trace-1');
    expect(ids[1]).toMatch(/^test-/);
    expect(contentLength).toBe(String(Buffer.byteLength('{"a":1}')));
  });

  it('defaults ip to 127.0.0.1 and supports spoofing per client and per request', async () => {
    const app = new Axiomify();
    const ips: string[] = [];
    app.route({
      method: 'GET',
      path: '/ip',
      handler: async (req, res) => {
        ips.push(req.ip);
        res.send(null);
      },
    });

    const base = createTestClient(app);
    await base.get('/ip');
    await createTestClient(app, { ip: '10.0.0.9' }).get('/ip');
    await base.withIp('192.168.1.1').get('/ip');
    await base.get('/ip', { ip: '203.0.113.7' });
    expect(ips).toEqual([
      '127.0.0.1',
      '10.0.0.9',
      '192.168.1.1',
      '203.0.113.7',
    ]);
  });

  it('withState pre-populates write-once request state before dispatch', async () => {
    const app = new Axiomify();
    let user: any;
    let tenant: any;
    app.route({
      method: 'GET',
      path: '/me',
      handler: async (req, res) => {
        user = req.state.get('user');
        tenant = req.state['tenant'];
        res.send(null);
      },
    });

    const client = createTestClient(app)
      .withState('user', { id: 7 })
      .withState('tenant', 'acme');
    await client.get('/me');
    expect(user).toEqual({ id: 7 });
    expect(tenant).toBe('acme');

    // per-request state overrides client defaults
    await client.get('/me', { state: { tenant: 'other' } });
    expect(tenant).toBe('other');
  });

  it('provides a lazy AbortSignal and abort() helper', async () => {
    const app = new Axiomify();
    let aborted: boolean | undefined;
    app.route({
      method: 'GET',
      path: '/sig',
      handler: async (req, res) => {
        aborted = req.signal?.aborted;
        res.send(null);
      },
    });
    await createTestClient(app).get('/sig');
    expect(aborted).toBe(false);
  });

  it('exposes every convenience verb', async () => {
    const app = new Axiomify();
    const methods: string[] = [];
    for (const method of [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ] as const) {
      app.route({
        method,
        path: '/verb',
        handler: async (req, res) => {
          methods.push(req.method);
          res.send(null);
        },
      });
    }

    const client = createTestClient(app);
    await client.get('/verb');
    await client.post('/verb');
    await client.put('/verb');
    await client.patch('/verb');
    await client.delete('/verb');
    await client.head('/verb');
    await client.options('/verb');
    expect(methods).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ]);
  });

  it('defaults the method to GET and accepts lowercase methods', async () => {
    const app = new Axiomify();
    let method: string | undefined;
    app.route({
      method: 'GET',
      path: '/m',
      handler: async (req, res) => {
        method = req.method;
        res.send(null);
      },
    });

    const client = createTestClient(app);
    await client.inject({ url: '/m' });
    expect(method).toBe('GET');
    await client.inject({ url: '/m', method: 'get' as any });
    expect(method).toBe('GET');
  });
});

describe('hooks', () => {
  it('fires onRequest, onPreHandler, onPostHandler and onClose in order', async () => {
    const app = new Axiomify();
    const order: string[] = [];
    app.addHook('onRequest', () => void order.push('onRequest'));
    app.addHook('onPreHandler', () => void order.push('onPreHandler'));
    app.addHook('onPostHandler', () => void order.push('onPostHandler'));
    app.addHook('onClose', () => void order.push('onClose'));
    app.route({
      method: 'GET',
      path: '/hooks',
      handler: async (_req, res) => {
        order.push('handler');
        res.send(null);
      },
    });

    await createTestClient(app).get('/hooks');
    expect(order).toEqual([
      'onRequest',
      'onPreHandler',
      'handler',
      'onPostHandler',
      'onClose',
    ]);
  });

  it('an onRequest hook may short-circuit with its own response', async () => {
    const app = new Axiomify();
    app.addHook('onRequest', (_req, res) => {
      res.status(401).send(null, 'Unauthorized');
    });
    const handler = vi.fn();
    app.route({ method: 'GET', path: '/guarded', handler });

    const res = await createTestClient(app).get('/guarded');
    expect(res.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('groups', () => {
  it('dispatches group routes with merged plugins', async () => {
    const app = new Axiomify();
    const plugin = vi.fn();
    app.group('/api', { plugins: [plugin] }, (g) => {
      g.group('/v1', (v1) => {
        v1.route({
          method: 'GET',
          path: '/status',
          handler: async (_req, res) => res.send({ up: true }),
        });
      });
    });

    const res = await createTestClient(app).get('/api/v1/status');
    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ up: true });
    expect(plugin).toHaveBeenCalledOnce();
  });

  it('scopes group onPreHandler hooks to routes inside the group', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();
    app.group('/admin', (g) => {
      g.addHook('onPreHandler', scoped);
      g.route({
        method: 'GET',
        path: '/panel',
        handler: async (_req, res) => res.send(null),
      });
    });
    app.route({
      method: 'GET',
      path: '/public',
      handler: async (_req, res) => res.send(null),
    });

    const client = createTestClient(app);
    await client.get('/public');
    expect(scoped).not.toHaveBeenCalled();
    await client.get('/admin/panel');
    expect(scoped).toHaveBeenCalledOnce();
  });

  it('scopes group onRequest hooks by path prefix', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();
    app.group('/api', (g) => {
      g.addHook('onRequest', scoped);
      g.route({
        method: 'GET',
        path: '/thing',
        handler: async (_req, res) => res.send(null),
      });
    });
    app.route({
      method: 'GET',
      path: '/apiary',
      handler: async (_req, res) => res.send(null),
    });

    const client = createTestClient(app);
    await client.get('/apiary'); // prefix must not match /api → /apiary
    expect(scoped).not.toHaveBeenCalled();
    await client.get('/api/thing');
    expect(scoped).toHaveBeenCalledOnce();
  });
});
