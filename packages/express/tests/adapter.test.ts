import { Axiomify } from '@axiomify/core';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpressAdapter } from '../src/index';
import { translateRequest, translateResponse } from '../src/translator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSerializer = (
  data: unknown,
  _message?: string,
  statusCode?: number,
  isError?: boolean,
) => ({
  status: isError || (statusCode && statusCode >= 400) ? 'failed' : 'success',
  data,
});

const mockAxiomifyReq: any = {
  id: 'test-id',
  method: 'GET',
  url: '/test',
  path: '/test',
  ip: '127.0.0.1',
  headers: {},
  body: {},
  query: {},
  params: {},
  state: {},
  raw: null,
  stream: null,
};

// ---------------------------------------------------------------------------
// Translator unit tests
// ---------------------------------------------------------------------------

describe('Express Adapter Translators', () => {
  it('maps method, path, ip, body, query, and headers via translateRequest', () => {
    const mockExpressReq: any = {
      method: 'POST',
      path: '/api/v1/test',
      url: '/api/v1/test',
      ip: '127.0.0.1',
      body: { key: 'value' },
      query: { search: 'term' },
      headers: { authorization: 'Bearer token' },
      params: {},
      socket: { remoteAddress: '127.0.0.1' },
    };

    const req = translateRequest(mockExpressReq);

    expect(req.method).toBe('POST');
    expect(req.path).toBe('/api/v1/test');
    expect(req.ip).toBe('127.0.0.1');
    expect(req.body).toMatchObject({ key: 'value' });
    expect(req.query).toStrictEqual({ search: 'term' });
    expect(req.headers.authorization).toBe('Bearer token');
  });

  it('strips __proto__, constructor, and prototype keys from body via translateRequest', () => {
    const mockExpressReq: any = {
      method: 'POST',
      path: '/api',
      url: '/api',
      ip: '127.0.0.1',
      body: { __proto__: { polluted: true }, safe: 'yes' },
      query: {},
      headers: {},
      params: {},
      socket: { remoteAddress: '127.0.0.1' },
    };

    const req = translateRequest(mockExpressReq);
    expect((req.body as any).__proto__).toBeUndefined();
    expect((req.body as any).safe).toBe('yes');
    expect(({} as any).polluted).toBeUndefined();
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', () => {
    const mockExpressReq: any = {
      method: 'GET',
      path: '/',
      url: '/',
      ip: undefined,
      body: {},
      query: {},
      headers: {},
      params: {},
      socket: { remoteAddress: '10.0.0.1' },
    };
    const req = translateRequest(mockExpressReq);
    expect(req.ip).toBe('10.0.0.1');
  });

  it('translateResponse.send serialises through the serializer', () => {
    const mockExpressRes: any = {
      status: () => mockExpressRes,
      setHeader: () => {},
      getHeader: () => undefined,
      removeHeader: () => {},
      json: (payload: any) => { captured = payload; },
      headersSent: false,
    };
    let captured: unknown;
    const axiomifyRes = translateResponse(
      mockExpressRes,
      mockSerializer as any,
      mockAxiomifyReq,
    );
    axiomifyRes.status(200).send({ hello: 'world' });
    expect((captured as any).data).toEqual({ hello: 'world' });
    expect((captured as any).status).toBe('success');
  });

  it('translateResponse.send sets isError=true for 4xx status codes', () => {
    const mockExpressRes: any = {
      status: () => mockExpressRes,
      setHeader: () => {},
      getHeader: () => undefined,
      removeHeader: () => {},
      json: (payload: any) => { captured = payload; },
      headersSent: false,
    };
    let captured: unknown;
    const axiomifyRes = translateResponse(
      mockExpressRes,
      mockSerializer as any,
      mockAxiomifyReq,
    );
    axiomifyRes.status(404).send(null, 'Not Found');
    expect((captured as any).status).toBe('failed');
  });

  it('translateResponse.send is idempotent — second call is a no-op', () => {
    let callCount = 0;
    const mockExpressRes: any = {
      status: () => mockExpressRes,
      setHeader: () => {},
      getHeader: () => undefined,
      removeHeader: () => {},
      json: () => { callCount++; },
      headersSent: false,
    };
    const axiomifyRes = translateResponse(mockExpressRes, mockSerializer as any, mockAxiomifyReq);
    axiomifyRes.send({ first: true });
    axiomifyRes.send({ second: true });
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real HTTP round-trips
// ---------------------------------------------------------------------------

describe('ExpressAdapter: routing via Express router', () => {
  let adapter: ExpressAdapter;
  let port: number;

  function request(path: string, method: string, body?: unknown): Promise<{ status: number; data: any; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          port,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
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

  beforeAll(async () => {
    const app = new Axiomify();

    app.route({
      method: 'GET',
      path: '/users',
      handler: async (_req, res) => res.send([{ id: 1 }]),
    });

    app.route({
      method: 'GET',
      path: '/users/:id',
      handler: async (req, res) => res.send({ id: req.params }),
    });

    app.route({
      method: 'POST',
      path: '/users',
      handler: async (req, res) => res.status(201).send(req.body),
    });

    adapter = new ExpressAdapter(app);

    await new Promise<void>((resolve) => {
      const server = adapter.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await adapter.close();
  });

  it('routes GET /users using Express router — returns 200', async () => {
    const res = await request('/users', 'GET');
    expect(res.status).toBe(200);
    expect(res.data.data).toEqual([{ id: 1 }]);
  });

  it('routes GET /users/:id — Express populates req.params', async () => {
    const res = await request('/users/42', 'GET');
    expect(res.status).toBe(200);
    expect(res.data.data.id).toMatchObject({ id: '42' });
  });

  it('routes POST /users — parses JSON body and returns 201', async () => {
    const res = await request('/users', 'POST', { name: 'Ada' });
    expect(res.status).toBe(201);
    expect(res.data.data).toMatchObject({ name: 'Ada' });
  });

  it('returns 404 for unregistered path (no double routing)', async () => {
    const res = await request('/nonexistent', 'GET');
    expect(res.status).toBe(404);
  });

  it('returns 405 for registered path with wrong method', async () => {
    const res = await request('/users', 'DELETE');
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toContain('GET');
    expect(res.headers['allow']).toContain('POST');
  });

  it('includes X-Request-Id on every response via onRequest hook', async () => {
    const res = await request('/users', 'GET');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('prototype pollution via __proto__ in JSON body does not mutate Object.prototype', async () => {
    await request('/users', 'POST', { __proto__: { polluted: true } });
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe('ExpressAdapter: body size limit enforcement', () => {
  let adapter: ExpressAdapter;
  let port: number;

  beforeAll(async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => res.send(req.body),
    });

    adapter = new ExpressAdapter(app, { bodyLimit: '1kb' });

    await new Promise<void>((resolve) => {
      const server = adapter.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => await adapter.close());

  it('accepts bodies under the 1 KB limit', async () => {
    const body = { small: 'payload' };
    return new Promise<void>((resolve, reject) => {
      const str = JSON.stringify(body);
      const req = http.request({ port, path: '/echo', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(str).toString() } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => { expect(res.statusCode).toBe(200); resolve(); });
      });
      req.on('error', reject);
      req.write(str);
      req.end();
    });
  });

  it('rejects bodies over the 1 KB limit with 413', async () => {
    return new Promise<void>((resolve, reject) => {
      const large = JSON.stringify({ data: 'x'.repeat(2048) });
      const req = http.request({ port, path: '/echo', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(large).toString() } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => { expect(res.statusCode).toBe(413); resolve(); });
      });
      req.on('error', reject);
      req.write(large);
      req.end();
    });
  });
});
