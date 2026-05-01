import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

// uWS.js ships pre-built Node-ABI binaries for specific LTS versions only.
// The static import would throw on unsupported runtimes; use dynamic imports
// inside the suite so describe.skipIf can prevent them from executing.
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
const uwsSupported = [16, 18, 20].includes(nodeMajor);

describe.skipIf(!uwsSupported)('Level 3 Native Engine (uWebSockets.js)', () => {
  let app: any;
  let adapter: any;
  const PORT = 3001;

  beforeAll(async () => {
    const { Axiomify, z } = await import('@axiomify/core');
    const { NativeAdapter, adaptMiddleware } = await import('../src/index');

    return new Promise<void>((resolve) => {
      app = new Axiomify();

      app.route({
        method: 'GET',
        path: '/ping',
        handler: async (req: any, res: any) => {
          res.send({ message: 'pong' });
        },
      });

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

      app.route({
        method: 'POST',
        path: '/upload',
        handler: async (req: any, res: any) => {
          const isBuffer = Buffer.isBuffer(req.body);
          res.send({ isBuffer, size: (req.body as Buffer).length });
        },
      });

      const dummyExpressMiddleware = (req: any, res: any, next: any) => {
        res.setHeader('X-Bridged', 'true');
        next();
      };

      app.route({
        method: 'GET',
        path: '/bridge',
        handler: async (req: any, res: any) => {
          await adaptMiddleware(dummyExpressMiddleware)(req, res);
          res.send({ bridged: true });
        },
      });

      adapter = new NativeAdapter(app, {
        port: PORT,
        ws: {
          open: (ws: any) => {
            ws.send('Welcome to Axiomify Native');
          },
          message: (ws: any, message: any, isBinary: any) => {
            ws.send(message, isBinary);
          },
        },
      });
      adapter.listen(() => resolve());
    });
  });

  afterAll(() => {
    adapter.close();
  });

  it('should process a high-speed GET request natively', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.message).toBe('pong');
  });

  it('should automatically parse application/json bodies', async () => {
    const res = await fetch(`http://localhost:${PORT}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'native-value' }),
    });
    const data = await res.json();
    expect(data.data.received).toBe('native-value');
  });

  it('should leave non-JSON bodies as raw Buffers for external parsing', async () => {
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

  it('should execute standard Express middleware via the compatibility bridge', async () => {
    const res = await fetch(`http://localhost:${PORT}/bridge`);
    expect(res.headers.get('X-Bridged')).toBe('true');
  });

  it('should perform a native C++ WebSocket handshake and echo messages', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

      ws.on('open', () => {
        ws.send('test-frame');
      });

      ws.on('message', (msg) => {
        const received = msg.toString();
        if (received === 'test-frame') {
          ws.close();
          resolve();
        } else if (received !== 'Welcome to Axiomify Native') {
          reject(new Error(`Unexpected WS message: ${received}`));
        }
      });

      ws.on('error', (err) => reject(err));
    });
  });
});
