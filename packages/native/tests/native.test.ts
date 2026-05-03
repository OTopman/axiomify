import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

// uWS.js ships pre-built Node-ABI binaries for specific LTS versions only.
// Detect support at runtime by checking whether the binary can be loaded,
// rather than hard-coding version numbers that drift with each uWS release.
let uwsSupported = false;
try {
  require('uWebSockets.js');
  uwsSupported = true;
} catch {
  uwsSupported = false;
}

describe.skipIf(!uwsSupported)('NativeAdapter (uWebSockets.js)', () => {
  let app: any;
  let adapter: any;
  const PORT = 3001;

  beforeAll(async () => {
    const { Axiomify, z } = await import('@axiomify/core');
    const { NativeAdapter, adaptMiddleware } = await import('../src/index');

    app = new Axiomify();

    // Basic GET
    app.route({
      method: 'GET',
      path: '/ping',
      handler: async (_req: any, res: any) => {
        res.send({ message: 'pong' });
      },
    });

    // Parameterised route
    app.route({
      method: 'GET',
      path: '/users/:id',
      handler: async (req: any, res: any) => {
        res.send({ id: req.params.id });
      },
    });

    // Multi-param route
    app.route({
      method: 'GET',
      path: '/users/:userId/posts/:postId',
      handler: async (req: any, res: any) => {
        res.send({ userId: req.params.userId, postId: req.params.postId });
      },
    });

    // POST with JSON body and Zod validation
    app.route({
      method: 'POST',
      path: '/data',
      schema: {
        body: z.object({ key: z.string() }),
      },
      handler: async (req: any, res: any) => {
        res.send({ received: req.body.key });
      },
    });

    // POST raw binary body
    app.route({
      method: 'POST',
      path: '/upload',
      handler: async (req: any, res: any) => {
        const isBuffer = Buffer.isBuffer(req.body);
        res.send({ isBuffer, size: (req.body as Buffer).length });
      },
    });

    // URL-encoded body
    app.route({
      method: 'POST',
      path: '/form',
      handler: async (req: any, res: any) => {
        res.send({ data: req.body });
      },
    });

    // Query string
    app.route({
      method: 'GET',
      path: '/search',
      handler: async (req: any, res: any) => {
        res.send({ query: req.query });
      },
    });

    // Multi-value query param
    app.route({
      method: 'GET',
      path: '/tags',
      handler: async (req: any, res: any) => {
        res.send({ tags: req.query.tag });
      },
    });

    // Express middleware bridge
    const dummyMiddleware = (req: any, res: any, next: any) => {
      res.setHeader('X-Bridged', 'true');
      next();
    };
    app.route({
      method: 'GET',
      path: '/bridge',
      handler: async (req: any, res: any) => {
        await adaptMiddleware(dummyMiddleware)(req, res);
        res.send({ bridged: true });
      },
    });

    // DELETE route (uses uWS .del())
    app.route({
      method: 'DELETE',
      path: '/items/:id',
      handler: async (req: any, res: any) => {
        res.status(204).send(null);
      },
    });

    return new Promise<void>((resolve) => {
      adapter = new NativeAdapter(app, {
        port: PORT,
        ws: {
          open: (ws: any) => ws.send('Welcome to Axiomify Native'),
          message: (ws: any, message: any, isBinary: any) => ws.send(message, isBinary),
        },
      });
      adapter.listen(() => resolve());
    });
  });

  afterAll(() => {
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Basic routing
  // -------------------------------------------------------------------------

  it('routes GET /ping via uWS C++ router — returns 200', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.message).toBe('pong');
  });

  it('extracts single :id param from uWS getParameter(0)', async () => {
    const res = await fetch(`http://localhost:${PORT}/users/42`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.id).toBe('42');
  });

  it('extracts multiple params — /users/:userId/posts/:postId', async () => {
    const res = await fetch(`http://localhost:${PORT}/users/10/posts/99`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toMatchObject({ userId: '10', postId: '99' });
  });

  // -------------------------------------------------------------------------
  // 404 / 405 fallback
  // -------------------------------------------------------------------------

  it('returns 404 for unregistered path', async () => {
    const res = await fetch(`http://localhost:${PORT}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('returns 405 with Allow header for registered path with wrong method', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`, { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toContain('GET');
  });

  // -------------------------------------------------------------------------
  // Body parsing
  // -------------------------------------------------------------------------

  it('parses application/json body for POST requests', async () => {
    const res = await fetch(`http://localhost:${PORT}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'native-value' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.received).toBe('native-value');
  });

  it('returns 422 when Zod validation fails on POST /data', async () => {
    const res = await fetch(`http://localhost:${PORT}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 123 }), // should be string
    });
    expect(res.status).toBe(400);
  });

  it('leaves non-JSON body as raw Buffer for /upload', async () => {
    const rawData = Buffer.from('binary-data-stream');
    const res = await fetch(`http://localhost:${PORT}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: rawData,
    });
    const data = await res.json();
    expect(data.data.isBuffer).toBe(true);
    expect(data.data.size).toBe(rawData.length);
  });

  it('parses application/x-www-form-urlencoded body', async () => {
    const res = await fetch(`http://localhost:${PORT}/form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Ada', role: 'engineer' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.data).toMatchObject({ name: 'Ada', role: 'engineer' });
  });

  // -------------------------------------------------------------------------
  // Query strings
  // -------------------------------------------------------------------------

  it('parses single query parameter', async () => {
    const res = await fetch(`http://localhost:${PORT}/search?q=hello`);
    const data = await res.json();
    expect(data.data.query.q).toBe('hello');
  });

  it('preserves multi-value query params as arrays', async () => {
    const res = await fetch(`http://localhost:${PORT}/tags?tag=a&tag=b&tag=c`);
    const data = await res.json();
    expect(Array.isArray(data.data.tags)).toBe(true);
    expect(data.data.tags).toEqual(['a', 'b', 'c']);
  });

  // -------------------------------------------------------------------------
  // HEAD requests
  // -------------------------------------------------------------------------

  it('auto-registers HEAD for GET routes — returns 200 with no body', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    // HEAD responses must not include a body.
    const text = await res.text();
    expect(text).toBe('');
  });

  // -------------------------------------------------------------------------
  // DELETE (uses uWS .del())
  // -------------------------------------------------------------------------

  it('routes DELETE /items/:id via uWS .del() — returns 204', async () => {
    const res = await fetch(`http://localhost:${PORT}/items/5`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  // -------------------------------------------------------------------------
  // Security headers via onRequest hook
  // -------------------------------------------------------------------------

  it('includes X-Request-Id on every response', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Middleware bridge
  // -------------------------------------------------------------------------

  it('executes standard Express middleware via the compatibility bridge', async () => {
    const res = await fetch(`http://localhost:${PORT}/bridge`);
    expect(res.headers.get('X-Bridged')).toBe('true');
    const data = await res.json();
    expect(data.data.bridged).toBe(true);
  });

  // -------------------------------------------------------------------------
  // WebSocket (native C++ handshake)
  // -------------------------------------------------------------------------

  it('performs a native C++ WebSocket handshake and echoes messages', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

      ws.on('open', () => ws.send('test-frame'));

      ws.on('message', (msg) => {
        const received = msg.toString();
        if (received === 'test-frame') {
          ws.close();
          resolve();
        } else if (received !== 'Welcome to Axiomify Native') {
          reject(new Error(`Unexpected WS message: ${received}`));
        }
      });

      ws.on('error', reject);
    });
  });
});

// ---------------------------------------------------------------------------
// SSE guard (no uWS dependency — tests the guard module directly)
// ---------------------------------------------------------------------------

describe('NativeAdapter: SSE guard prevents SSE routes at startup', () => {
  it('throws if any registered route calls res.sseInit()', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { assertNoNativeSseRoutes } = await import('../src/sse-guard');

    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/stream',
      handler: async (_req: any, res: any) => {
        res.sseInit();
        res.sseSend({ event: 'open' });
      },
    });

    expect(() => assertNoNativeSseRoutes(app.registeredRoutes)).toThrow(/SSE/);
  });
});

// ---------------------------------------------------------------------------
// Buffer pool / body size limit
// ---------------------------------------------------------------------------

describe.skipIf(!uwsSupported)('NativeAdapter: body size limit enforcement', () => {
  let adapter: any;
  const LIMIT_PORT = 3099;

  beforeAll(async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');

    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/echo',
      handler: async (req: any, res: any) => res.send(req.body),
    });

    return new Promise<void>((resolve) => {
      adapter = new NativeAdapter(app, { port: LIMIT_PORT, maxBodySize: 1024 });
      adapter.listen(() => resolve());
    });
  });

  afterAll(() => adapter.close());

  it('accepts bodies under the limit', async () => {
    const res = await fetch(`http://localhost:${LIMIT_PORT}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ small: 'payload' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects bodies over the limit with 413', async () => {
    const large = JSON.stringify({ data: 'x'.repeat(2048) });
    const res = await fetch(`http://localhost:${LIMIT_PORT}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: large,
    });
    expect(res.status).toBe(413);
  });
});

// ─── Handler rejection caught — no unhandled rejection crash ─────────────────

describe.skipIf(!uwsSupported)('NativeAdapter — handler rejection safety', () => {
  let adapter: any;
  const PORT = 3002;

  beforeAll(async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');

    const app = new Axiomify();

    // Route whose handler always throws — previously an unhandled rejection
    app.route({
      method: 'GET',
      path: '/throws',
      handler: async () => {
        throw new Error('Intentional handler error');
      },
    });

    return new Promise<void>((resolve) => {
      adapter = new NativeAdapter(app, { port: PORT });
      adapter.listen(() => resolve());
    });
  });

  afterAll(() => adapter.close());

  it('returns 500 instead of crashing the process on handler throw', async () => {
    const res = await fetch(`http://localhost:${PORT}/throws`);
    // The .catch() in the async IIFE must handle the rejection and send 500.
    expect(res.status).toBe(500);
  });

  it('continues serving subsequent requests after a handler throw', async () => {
    await fetch(`http://localhost:${PORT}/throws`);
    // Server must still respond — not crashed from unhandled rejection
    const r2 = await fetch(`http://localhost:${PORT}/throws`);
    expect(r2.status).toBe(500);
  });
});
