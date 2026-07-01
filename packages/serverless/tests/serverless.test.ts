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

    const json = await response.json();
    expect(json).toEqual({ pong: true });
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
    expect(json).toEqual({ id: '42', search: 'test' });
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
    expect(json).toEqual({ echoed: 12345 });
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
    expect(json).toEqual({ foo: 'bar', baz: 'qux' });
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
});
