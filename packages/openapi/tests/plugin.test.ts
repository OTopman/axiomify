import { Axiomify } from '@axiomify/core';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpAdapter } from '../../http/src';
import { useOpenAPI } from '../src';

describe('useOpenAPI plugin routes', () => {
  let server: http.Server;
  let port: number;

  beforeAll(() => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (_req, res) => res.send({ ok: true }),
    });
    useOpenAPI(app, {
      routePrefix: '/docs',
      info: { title: 'Test API', version: '1.0.0' },
    });

    const adapter = new HttpAdapter(app);
    server = adapter.listen(0);
    port = (server.address() as any).port;
  });

  afterAll(() => {
    server.close();
  });

  const request = (path: string) =>
    new Promise<{ status: number; body: string }>((resolve) => {
      const req = http.request({ port, path, method: 'GET' }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      });
      req.end();
    });

  it('serves docs UI on routePrefix without trailing slash', async () => {
    const res = await request('/docs');
    expect(res.status).toBe(200);
    expect(res.body).toContain('SwaggerUIBundle');
  });

  it('serves docs UI on routePrefix with trailing slash', async () => {
    const res = await request('/docs');
    expect(res.status).toBe(200);
    expect(res.body).toContain('SwaggerUIBundle');
  });
});

describe('useOpenAPI plugin guards and root prefix', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  const startServer = (setup: (app: Axiomify) => void) => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (_req, res) => res.send({ ok: true }),
    });
    setup(app);
    const adapter = new HttpAdapter(app);
    const server = adapter.listen(0);
    const port = (server.address() as any).port as number;
    return { server, port };
  };

  const request = (port: number, path: string) =>
    new Promise<{ status: number; body: string }>((resolve) => {
      const req = http.request({ port, path, method: 'GET' }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      });
      req.end();
    });

  it('supports root routePrefix "/"', async () => {
    const { server, port } = startServer((app) => {
      useOpenAPI(app, {
        routePrefix: '/',
        info: { title: 'Root Docs', version: '1.0.0' },
      });
    });

    try {
      const docsRes = await request(port, '/');
      const specRes = await request(port, '/openapi.json');
      expect(docsRes.status).toBe(200);
      expect(docsRes.body).toContain('SwaggerUIBundle');
      expect(specRes.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('returns 403 when protect callback denies access', async () => {
    const { server, port } = startServer((app) => {
      useOpenAPI(app, {
        routePrefix: '/docs',
        info: { title: 'Protected Docs', version: '1.0.0' },
        protect: async () => false,
      });
    });

    try {
      const docsRes = await request(port, '/docs');
      const specRes = await request(port, '/docs/openapi.json');
      expect(docsRes.status).toBe(403);
      expect(specRes.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it('denies unprotected docs in production by default', async () => {
    process.env.NODE_ENV = 'production';
    const { server, port } = startServer((app) => {
      useOpenAPI(app, {
        routePrefix: '/docs',
        info: { title: 'Prod Docs', version: '1.0.0' },
      });
    });

    try {
      const docsRes = await request(port, '/docs');
      const specRes = await request(port, '/docs/openapi.json');
      expect(docsRes.status).toBe(403);
      expect(specRes.status).toBe(403);
    } finally {
      server.close();
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
