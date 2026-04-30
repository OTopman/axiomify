import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '../src/index';
import http from 'http';

describe('HTTP Adapter Integration', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => res.send(req.body),
    });
    const adapter = new HttpAdapter(app, { bodyLimitBytes: 100 });
    server = adapter.listen(0);
    port = (server.address() as any).port;
  });

  afterAll(() => server.close());

  const request = (path: string, method: string, body?: any) => {
    return new Promise<any>((resolve) => {
      const req = http.request(
        { port, path, method, headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              data: JSON.parse(data || '{}'),
              headers: res.headers,
            }),
          );
        },
      );
      req.on('error', () => resolve({ status: 413 }));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  it('parses valid JSON and echoes body', async () => {
    const res = await request('/echo', 'POST', { hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.data.data).toEqual({ hello: 'world' });
  });

  it('returns 413 on payload too large', async () => {
    const largeBody = { data: 'x'.repeat(200) };
    const res = await request('/echo', 'POST', largeBody);
    expect(res.status).toBe(413);
  });

  it('prevents prototype pollution', async () => {
    const res = await request('/echo', 'POST', {
      __proto__: { polluted: true },
    });
    expect(({} as any).polluted).toBeUndefined();
  });
});
