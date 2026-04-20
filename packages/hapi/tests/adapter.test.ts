import { Axiomify } from '@axiomify/core';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HapiAdapter } from '../src/index';

describe('Hapi Adapter Integration', () => {
  let adapter: HapiAdapter;
  let port: number;

  beforeAll(async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => res.send(req.body),
    });

    adapter = new HapiAdapter(app);
    const native = (adapter as any).server;
    native.settings.port = 0;
    await native.start();
    port = native.info.port;
  });

  afterAll(async () => {
    await adapter.close();
  });

  const request = (path: string, method: string, body?: any) => {
    return new Promise<any>((resolve, reject) => {
      const req = http.request(
        {
          port,
          path,
          method,
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              data: data ? JSON.parse(data) : {},
            }),
          );
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  };

  it('echoes a plain JSON body after stream-parsing', async () => {
    const res = await request('/echo', 'POST', { hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.data.data).toEqual({ hello: 'world' });
  });

  it('prevents prototype pollution via __proto__ in the request body', async () => {
    await request('/echo', 'POST', { __proto__: { polluted: true } });
    expect(({} as any).polluted).toBeUndefined();
  });

  it('strips constructor / prototype keys from the body', async () => {
    const res = await request('/echo', 'POST', {
      safe: 'yes',
      constructor: { bad: true },
      prototype: { bad: true },
    });
    expect(res.data.data).toEqual({ safe: 'yes' });
  });
});
