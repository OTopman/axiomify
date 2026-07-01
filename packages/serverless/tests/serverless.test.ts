import { describe, it, expect } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { ServerlessAdapter } from '../src';
import { z } from 'zod';
import { Readable } from 'node:stream';

describe('ServerlessAdapter', () => {
  it('should route basic GET requests successfully', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (req, res) => {
        res.send({ pong: true });
      },
    });

    const adapter = new ServerlessAdapter(app);
    const request = new Request('http://localhost/ping', {
      method: 'GET',
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    // Responses are wrapped by the app serializer, same envelope as native.
    const json = await response.json();
    expect(json.status).toBe('success');
    expect(json.data).toEqual({ pong: true });
  });

  it('should handle parameterized routes and query parameters', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/user/:id',
      schema: {
        params: z.object({ id: z.string() }),
        query: z.object({ search: z.string().optional() }),
      },
      handler: async (req, res) => {
        res.send({
          id: req.params.id,
          search: req.query.search || null,
        });
      },
    });

    const adapter = new ServerlessAdapter(app);
    const request = new Request('http://localhost/user/42?search=test', {
      method: 'GET',
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data).toEqual({ id: '42', search: 'test' });
  });

  it('should read and parse JSON body on POST requests', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      schema: {
        body: z.object({ value: z.number() }),
      },
      handler: async (req, res) => {
        res.status(201).send({ echoed: req.body.value });
      },
    });

    const adapter = new ServerlessAdapter(app);
    const request = new Request('http://localhost/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ value: 12345 }),
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.data).toEqual({ echoed: 12345 });
  });

  it('should support urlencoded bodies', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/urlencoded',
      handler: async (req, res) => {
        res.send(req.body);
      },
    });

    const adapter = new ServerlessAdapter(app);
    const request = new Request('http://localhost/urlencoded', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'foo=bar&baz=qux',
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('should propagate response headers properly', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/headers',
      handler: async (req, res) => {
        res.header('x-custom-response', 'hello-world');
        res.send({ ok: true });
      },
    });

    const adapter = new ServerlessAdapter(app);
    const request = new Request('http://localhost/headers', {
      method: 'GET',
    });

    const response = await adapter.handle(request);
    expect(response.headers.get('x-custom-response')).toBe('hello-world');
  });

  it('should support response streaming', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/stream',
      handler: async (req, res) => {
        const readable = Readable.from(['hello', ' ', 'world']);
        res.stream(readable, 'text/plain');
      },
    });

    const adapter = new ServerlessAdapter(app);
    const request = new Request('http://localhost/stream', {
      method: 'GET',
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');

    const text = await response.text();
    expect(text).toBe('hello world');
  });

  it('rejects an over-limit body via declared Content-Length (fast path)', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (_req, res) => res.send({ ok: true }),
    });

    const adapter = new ServerlessAdapter(app, { maxBodySize: 16 });
    const request = new Request('http://localhost/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(64) }),
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(413);
  });

  it('rejects an over-limit streamed body with no Content-Length before buffering it all (M5)', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/upload',
      handler: async (_req, res) => res.send({ ok: true }),
    });

    const adapter = new ServerlessAdapter(app, { maxBodySize: 1024 });

    // Emit chunks lazily; the adapter must abort partway through, so not every
    // chunk is pulled. A ReadableStream body carries no Content-Length header.
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        if (emitted > 1000) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(512)); // 512 bytes per chunk
      },
    });

    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: stream,
      // @ts-expect-error duplex is required by Node when streaming a body
      duplex: 'half',
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(413);
    // Aborted early: only a handful of chunks pulled, not all 1000.
    expect(emitted).toBeLessThan(20);
  });

  it('accepts a within-limit streamed body with no Content-Length', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      schema: { body: z.object({ value: z.number() }) },
      handler: async (req, res) => res.status(201).send({ echoed: req.body.value }),
    });

    const adapter = new ServerlessAdapter(app, { maxBodySize: 1024 });
    const payload = new TextEncoder().encode(JSON.stringify({ value: 7 }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });

    const request = new Request('http://localhost/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // @ts-expect-error duplex is required by Node when streaming a body
      duplex: 'half',
    });

    const response = await adapter.handle(request);
    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({ echoed: 7 });
  });

  it('applies a custom app serializer to send() responses (parity with native)', async () => {
    const app = new Axiomify();
    app.setSerializer(({ data, statusCode }) => ({
      ok: (statusCode ?? 200) < 400,
      payload: data,
    }));
    app.route({
      method: 'GET',
      path: '/thing',
      handler: async (_req, res) => res.send({ id: 1 }),
    });

    const adapter = new ServerlessAdapter(app);
    const response = await adapter.handle(
      new Request('http://localhost/thing', { method: 'GET' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ ok: true, payload: { id: 1 } });
  });

  it('reflects error status and message through the serializer envelope', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/missing',
      handler: async (_req, res) => res.status(404).send(null, 'Not Found'),
    });

    const adapter = new ServerlessAdapter(app);
    const response = await adapter.handle(
      new Request('http://localhost/missing', { method: 'GET' }),
    );

    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.status).toBe('failed');
    expect(json.message).toBe('Not Found');
    expect(json.data).toBeNull();
  });
});
