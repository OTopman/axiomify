import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { StudioRouter } from '../../src/studio/server/router';
import { createStudioServer } from '../../src/studio/server/http-server';
import { registerStudioApi } from '../../src/studio/api';
import { StudioWsServer } from '../../src/studio/server/ws-server';
import { Axiomify } from '@axiomify/core';

describe('Studio Server & Router', () => {
  it('should match registered routes on the router', () => {
    const router = new StudioRouter();
    const handler = vi.fn();

    router.get('/__studio/api/test', handler);
    router.post('/__studio/api/submit', handler);

    expect(router.match('GET', '/__studio/api/test')).toBe(handler);
    expect(router.match('POST', '/__studio/api/submit')).toBe(handler);
    expect(router.match('GET', '/nonexistent')).toBeNull();
  });

  it('should serve indexHtml for non-API routes', async () => {
    const router = new StudioRouter();
    const indexHtml = '<html>Hello Studio</html>';

    const server = createStudioServer({
      port: 0, // OS-assigned port
      router,
      indexHtml,
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/some-random-route`);
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(body).toBe(indexHtml);
    } finally {
      server.close();
    }
  });

  it('should enforce token authentication on API routes if token is specified', async () => {
    const router = new StudioRouter();
    const handler = vi.fn((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    router.get('/__studio/api/test', handler);

    const otlpHandler = vi.fn((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    router.post('/__studio/otlp/v1/traces', otlpHandler);

    const token = 'my-secret-token';
    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: '<html>Hello Studio</html>',
      token,
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      // 1. Request without token should fail with 401
      const resNoToken = await fetch(
        `http://127.0.0.1:${port}/__studio/api/test`,
      );
      expect(resNoToken.status).toBe(401);
      const bodyNoToken = (await resNoToken.json()) as any;
      expect(bodyNoToken.error).toBe('Unauthorized');

      // 2. Request with invalid token should fail with 401
      const resBadToken = await fetch(
        `http://127.0.0.1:${port}/__studio/api/test`,
        {
          headers: { Authorization: 'Bearer bad-token' },
        },
      );
      expect(resBadToken.status).toBe(401);

      // 3. Request with valid token should succeed with 200
      const resOkToken = await fetch(
        `http://127.0.0.1:${port}/__studio/api/test`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(resOkToken.status).toBe(200);
      const bodyOkToken = (await resOkToken.json()) as any;
      expect(bodyOkToken.ok).toBe(true);

      // 3.5. OTLP request without token should bypass authentication and succeed
      const resOtlpNoToken = await fetch(
        `http://127.0.0.1:${port}/__studio/otlp/v1/traces`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      expect(resOtlpNoToken.status).toBe(200);
      const bodyOtlp = (await resOtlpNoToken.json()) as any;
      expect(bodyOtlp.success).toBe(true);

      // 4. Request for non-API route should still succeed with 200 indexHtml without token
      const resHtml = await fetch(`http://127.0.0.1:${port}/some-random-route`);
      expect(resHtml.status).toBe(200);
      const bodyHtml = await resHtml.text();
      expect(bodyHtml).toBe('<html>Hello Studio</html>');
    } finally {
      server.close();
    }
  });

  it('should serve API routes registered on the router', async () => {
    const router = new StudioRouter();
    router.get('/__studio/api/hello', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello API');
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/hello`);
      const body = await res.text();

      expect(res.status).toBe(200);
      expect(body).toBe('Hello API');
    } finally {
      server.close();
    }
  });

  it('should serve registered Studio API health endpoint', async () => {
    const router = new StudioRouter();
    const mockHealth = {
      findings: [{ severity: 'warn', area: 'ops', message: 'test warning' }],
      summary: { passes: 0, warnings: 1, failures: 0 },
    };
    const mockDiscovery: any = {
      health: mockHealth,
      discoveredAt: new Date().toISOString(),
    };

    registerStudioApi(router, {
      getDiscovery: () => mockDiscovery,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/health`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.health).toEqual(mockHealth);
    } finally {
      server.close();
    }
  });

  it('should fall back to a random port if the requested port is busy', async () => {
    // 1. Start a server on a specific port to keep it busy.
    const busyServer = createServer((_req, res) => {
      res.end('Busy');
    });

    await new Promise<void>((resolve) => {
      busyServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = busyServer.address();
    const busyPort = typeof addr === 'object' && addr ? addr.port : 0;

    // 2. Try to start the Studio server on that same port.
    const router = new StudioRouter();
    let onReadyCalled = false;
    let actualPort: number | undefined;

    const studioServer = createStudioServer({
      port: busyPort,
      router,
      indexHtml: 'index',
      onReady: (port) => {
        onReadyCalled = true;
        actualPort = port;
      },
    });

    try {
      // Allow time for fallback listener to fire
      await new Promise<void>((resolve) => {
        const check = () => {
          if (onReadyCalled) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      expect(onReadyCalled).toBe(true);
      expect(actualPort).toBeDefined();
      expect(actualPort).not.toBe(busyPort);
    } finally {
      busyServer.close();
      studioServer.close();
    }
  });

  it('should upgrade and broadcast messages via StudioWsServer', async () => {
    const wsServer = new StudioWsServer();
    const router = new StudioRouter();
    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    server.on('upgrade', (req, socket) => {
      wsServer.handleUpgrade(req, socket);
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/__studio/ws`);

      const messagePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timeout waiting for message')),
          2000,
        );
        ws.onmessage = (event) => {
          clearTimeout(timeout);
          resolve(event.data);
        };
        ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(err);
        };
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timeout connecting')),
          2000,
        );
        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(err);
        };
      });

      const testMsg = JSON.stringify({ type: 'reload' });
      wsServer.broadcast(testMsg);

      const received = await messagePromise;
      expect(received).toBe(testMsg);

      ws.close();
    } finally {
      wsServer.close();
      server.close();
    }
  });

  it('should proxy requests to the in-memory app via POST /__studio/api/request', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/hello',
      handler: async (req, res) => {
        res.header('X-Response-Hello', 'world').send({ hello: 'world' });
      },
    });
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req, res) => {
        res.send({ bodyReceived: req.body });
      },
    });

    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => app,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      // 1. Test proxying a GET request
      const resGet = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'GET',
            path: '/hello',
          }),
        },
      );

      expect(resGet.status).toBe(200);
      const dataGet = await resGet.json();
      expect(dataGet.status).toBe(200);
      expect(dataGet.headers['x-response-hello']).toBe('world');
      expect(dataGet.body).toEqual({
        status: 'success',
        message: 'Operation successful',
        data: { hello: 'world' },
      });

      // 2. Test proxying a POST request with body
      const resPost = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'POST',
            path: '/echo',
            body: { foo: 'bar' },
          }),
        },
      );

      expect(resPost.status).toBe(200);
      const dataPost = await resPost.json();
      expect(dataPost.status).toBe(200);
      expect(dataPost.body).toEqual({
        status: 'success',
        message: 'Operation successful',
        data: { bodyReceived: { foo: 'bar' } },
      });
    } finally {
      server.close();
    }
  });

  it('should return profile timeline metadata when proxying requests', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/profile-test',
      handler: async (req, res) => {
        res.send({ ok: true });
      },
    });

    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => app,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path: '/profile-test',
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.profile).toBeDefined();
      expect(result.profile.timeline).toBeDefined();
      expect(result.profile.timeline.length).toBeGreaterThan(0);

      const handlerStep = result.profile.timeline.find(
        (t: any) => t.type === 'handler',
      );
      expect(handlerStep).toBeDefined();
      expect(handlerStep.name).toContain('Handler:');
    } finally {
      server.close();
    }
  });

  it('should support syncing OpenAPI schema to local file via POST /__studio/api/openapi/sync', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tempDir = path.resolve(__dirname, 'temp-server-sync');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    const mockSpec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1' },
    };
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({ openapi: mockSpec }) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(
        `http://127.0.0.1:${port}/__studio/api/openapi/sync`,
        {
          method: 'POST',
        },
      );

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.success).toBe(true);

      const filePath = path.resolve(tempDir, 'openapi.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(content).toEqual(mockSpec);

      fs.unlinkSync(filePath);
    } finally {
      server.close();
      cwdSpy.mockRestore();
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      } catch {
        // ignore
      }
    }
  });

  it('should serve system metrics endpoint GET /__studio/api/system', async () => {
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/system`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.nodeVersion).toBeDefined();
      expect(body.platform).toBe(process.platform);
      expect(body.memory).toBeDefined();
      expect(body.memory.heapUsed).toBeTypeOf('number');
      expect(body.cpu).toBeDefined();
    } finally {
      server.close();
    }
  });

  it('should serve app metrics endpoint GET /__studio/api/metrics', async () => {
    const mockApp = {
      registeredRoutes: [{ method: 'GET', path: '/metrics' }],
      handle: async (req: any, res: any) => {
        res
          .status(200)
          .sendRaw(
            'http_requests_total{method="GET",route="/test"} 10',
            'text/plain',
          );
      },
    };

    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => mockApp as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/metrics`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.available).toBe(true);
      expect(body.raw).toContain('http_requests_total');
      expect(body.path).toBe('/metrics');
    } finally {
      server.close();
    }
  });

  it('should serve recorded errors endpoint GET /__studio/api/errors', async () => {
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/errors`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.errorsToday).toBeDefined();
      expect(body.errors).toBeInstanceOf(Array);
    } finally {
      server.close();
    }
  });

  it('should serve websocket analytics endpoint GET /__studio/api/ws-analytics', async () => {
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(
        `http://127.0.0.1:${port}/__studio/api/ws-analytics`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.metrics).toBeDefined();
      expect(body.rates).toBeInstanceOf(Array);
    } finally {
      server.close();
    }
  });

  it('should support request replays via POST/GET /__studio/api/request/replay(s)', async () => {
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const payload = {
        id: 'test-id',
        method: 'POST',
        path: '/test-path',
        headers: { 'Content-Type': 'application/json' },
        query: {},
        body: { test: true },
      };

      const resPost = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request/replay`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      expect(resPost.status).toBe(200);
      const resPostJson = await resPost.json();
      expect(resPostJson.success).toBe(true);

      const resGet = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request/replays`,
      );
      const resGetJson = await resGet.json();

      expect(resGet.status).toBe(200);
      expect(resGetJson.history).toBeInstanceOf(Array);
      expect(resGetJson.history.length).toBeGreaterThan(0);
      const found = resGetJson.history.find((h: any) => h.id === 'test-id');
      expect(found).toBeDefined();

      // 1. Delete single replay item
      const resDeleteOne = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request/replay?id=test-id`,
        {
          method: 'DELETE',
        },
      );
      expect(resDeleteOne.status).toBe(200);
      const resDeleteOneJson = await resDeleteOne.json();
      expect(resDeleteOneJson.success).toBe(true);

      const resGetAfterDelete = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request/replays`,
      );
      const resGetAfterDeleteJson = await resGetAfterDelete.json();
      const foundAfterDelete = resGetAfterDeleteJson.history.find(
        (h: any) => h.id === 'test-id',
      );
      expect(foundAfterDelete).toBeUndefined();

      // 2. Clear all replay items
      const resClearAll = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request/replays`,
        {
          method: 'DELETE',
        },
      );
      expect(resClearAll.status).toBe(200);
      const resClearAllJson = await resClearAll.json();
      expect(resClearAllJson.success).toBe(true);

      const resGetAfterClear = await fetch(
        `http://127.0.0.1:${port}/__studio/api/request/replays`,
      );
      const resGetAfterClearJson = await resGetAfterClear.json();
      expect(resGetAfterClearJson.history.length).toBe(0);
    } finally {
      server.close();
      const fs = require('node:fs');
      const path = require('node:path');
      const histFile = path.join(
        process.cwd(),
        '.axiomify-studio-history.json',
      );
      if (fs.existsSync(histFile)) {
        try {
          fs.unlinkSync(histFile);
        } catch {
          // ignore
        }
      }
    }
  });

  it('should auto-capture requests via onRequest hook and notify updates', async () => {
    const { instrumentRequestReplay, setOnReplayUpdated } =
      await import('../../src/studio/api/replay');

    const app = new Axiomify();
    instrumentRequestReplay(app);

    let notified = false;
    setOnReplayUpdated(() => {
      notified = true;
    });

    // Simulate handling a normal request
    const mockReq: any = {
      id: 'normal-request-123',
      method: 'GET',
      path: '/api/test-capture',
      headers: {},
      query: {},
      body: null,
    };
    const responseHeaders: Record<string, string> = {};
    const mockRes: any = {
      headersSent: false,
      status(code: number) {
        return this;
      },
      header(key: string, value: string) {
        responseHeaders[key.toLowerCase()] = value;
        return this;
      },
      getHeader(key: string) {
        return responseHeaders[key.toLowerCase()];
      },
      removeHeader(key: string) {
        delete responseHeaders[key.toLowerCase()];
        return this;
      },
      send(data: any) {
        this.headersSent = true;
        return this;
      },
      capabilities: { sse: false, streaming: false },
    };

    // Trigger handle which runs the lifecycle hooks
    await app.handle(mockReq, mockRes);

    expect(notified).toBe(true);

    const { requestHistory } = await import('../../src/studio/api/replay');
    const captured = requestHistory.find((h) => h.path === '/api/test-capture');
    expect(captured).toBeDefined();
    expect(captured?.method).toBe('GET');

    // Clean up
    setOnReplayUpdated(() => {});
    const fs = require('node:fs');
    const path = require('node:path');
    const histFile = path.join(process.cwd(), '.axiomify-studio-history.json');
    if (fs.existsSync(histFile)) {
      try {
        fs.unlinkSync(histFile);
      } catch {
        // ignore
      }
    }
    requestHistory.length = 0;
  });

  it('should intercept console logs and serve them via API', async () => {
    const { instrumentLogs, setOnLogsUpdated, recordedLogs } =
      await import('../../src/studio/api/logs');

    instrumentLogs();

    let notified = false;
    setOnLogsUpdated(() => {
      notified = true;
    });

    console.warn('Hello warning test');

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(notified).toBe(true);

    const found = recordedLogs.find((l) => l.message === 'Hello warning test');
    expect(found).toBeDefined();
    expect(found?.level).toBe('warn');
    expect(found?.stack).toBeDefined();

    // Test API GET /__studio/api/logs
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const resGet = await fetch(`http://127.0.0.1:${port}/__studio/api/logs`);
      const bodyGet = await resGet.json();
      expect(resGet.status).toBe(200);
      expect(bodyGet.logs).toBeInstanceOf(Array);
      expect(
        bodyGet.logs.some((l: any) => l.message === 'Hello warning test'),
      ).toBe(true);

      // Test API DELETE /__studio/api/logs
      const resDel = await fetch(`http://127.0.0.1:${port}/__studio/api/logs`, {
        method: 'DELETE',
      });
      const bodyDel = await resDel.json();
      expect(resDel.status).toBe(200);
      expect(bodyDel.success).toBe(true);
      expect(recordedLogs.length).toBe(0);
    } finally {
      server.close();
      setOnLogsUpdated(() => {});
    }
  });

  it('should support exporting logs via GET /__studio/api/logs/export', async () => {
    const { recordedLogs } = await import('../../src/studio/api/logs');
    recordedLogs.length = 0;
    recordedLogs.push({
      id: 'test-log-1',
      level: 'info',
      message: 'Export log test message',
      timestamp: new Date().toISOString(),
    });

    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => ({}) as any,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const res = await fetch(`http://127.0.0.1:${port}/__studio/api/logs/export`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      const body = await res.json();
      expect(body.logs).toBeDefined();
      expect(body.logs.length).toBe(1);
      expect(body.logs[0].message).toBe('Export log test message');
    } finally {
      server.close();
    }
  });

  it('should enforce token auth on export endpoints', async () => {
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({
        routes: [],
        schemas: [],
        hooks: [],
        config: {
          timeout: 3000,
          routeConflict: 'throw',
          strictSchema: true,
          httpRouteCount: 0,
          wsRouteCount: 0,
          hookCount: 0,
          serviceCount: 0,
        },
        openapi: null,
        health: { findings: [], summary: { passes: 0, warnings: 0, failures: 0 } },
        discoveredAt: new Date().toISOString(),
      }) as any,
      getApp: () => ({}) as any,
    });

    const token = 'my-secret-token';
    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
      token,
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      // 1. Without token, should fail with 401 Unauthorized and specific JSON payload
      const resNoToken = await fetch(`http://127.0.0.1:${port}/__studio/api/export/html`);
      expect(resNoToken.status).toBe(401);
      const json = await resNoToken.json() as any;
      expect(json).toEqual({
        error: 'Unauthorized',
        message: 'Valid Access Token is required.',
      });

      // 2. With invalid token, should fail with 401 Unauthorized
      const resBadToken = await fetch(`http://127.0.0.1:${port}/__studio/api/export/html?token=bad`);
      expect(resBadToken.status).toBe(401);

      // 3. With valid token (query param), should succeed with 200
      const resOkToken = await fetch(`http://127.0.0.1:${port}/__studio/api/export/html?token=${token}`);
      expect(resOkToken.status).toBe(200);
      const text = await resOkToken.text();
      expect(text).toContain('Axiomify Studio Report');
    } finally {
      server.close();
    }
  });

  it('should trace logs to request ID correlation', async () => {
    const { instrumentLogs, recordedLogs, logCorrelationStorage } =
      await import('../../src/studio/api/logs');

    instrumentLogs();
    recordedLogs.length = 0;

    const reqId = 'my-test-request-id-123';
    logCorrelationStorage.run(reqId, () => {
      console.log('correlation trace message');
    });

    const found = recordedLogs.find((l) => l.message === 'correlation trace message');
    expect(found).toBeDefined();
    expect(found?.requestId).toBe(reqId);
  });

  it('should serve jobs status via GET /__studio/api/jobs', async () => {
    const app = new Axiomify();
    const router = new StudioRouter();
    registerStudioApi(router, {
      getDiscovery: () => ({}) as any,
      getApp: () => app,
    });

    const server = createStudioServer({
      port: 0,
      router,
      indexHtml: 'index',
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      // Case 1: Jobs module not registered
      const res1 = await fetch(`http://127.0.0.1:${port}/__studio/api/jobs`);
      expect(res1.status).toBe(200);
      const data1 = await res1.json() as any;
      expect(data1.available).toBe(false);
      expect(data1.message).toContain('Jobs plugin is not active');

      // Case 2: Jobs module is registered
      const mockJobs = [
        { id: 'job-1', name: 'send-email', queue: 'default', status: 'completed', attempts: 1, maxAttempts: 3, runAt: Date.now() },
        { id: 'job-2', name: 'process-image', queue: 'media', status: 'failed', attempts: 3, maxAttempts: 3, runAt: Date.now(), error: 'OutOfMemory' },
        { id: 'job-3', name: 'generate-report', queue: 'default', status: 'running', attempts: 1, maxAttempts: 3, runAt: Date.now() },
      ];
      const mockScheduler = {
        storage: {
          getJobs: async () => mockJobs,
        },
      };
      (app as any)._services.set('jobs', mockScheduler);

      const res2 = await fetch(`http://127.0.0.1:${port}/__studio/api/jobs`);
      expect(res2.status).toBe(200);
      const data2 = await res2.json() as any;
      expect(data2.available).toBe(true);
      expect(data2.jobs).toHaveLength(3);
      expect(data2.stats).toEqual({
        total: 3,
        pending: 0,
        running: 1,
        completed: 1,
        failed: 1,
        successRate: 33,
      });
    } finally {
      server.close();
    }
  });
});
