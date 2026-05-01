import { Axiomify, z } from '@axiomify/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NativeAdapter, adaptMiddleware } from '../src/index';

describe('Level 3 Native Engine (uWebSockets.js)', () => {
  let app: Axiomify;
  let adapter: NativeAdapter;
  const PORT = 3001; // Using 3001 to avoid conflicts with local dev

  beforeAll(async () => {
    return new Promise<void>((resolve) => {
      app = new Axiomify();

      // 1. Standard High-Speed JSON Route
      app.route({
        method: 'GET',
        path: '/ping',
        handler: async (req, res) => {
          res.send({ message: 'pong' });
        },
      });

      // 2. Body Parser Route (JSON)
      app.route({
        method: 'POST',
        path: '/data',
        schema: {
          body: z.object({
            key: z.string(),
          }),
        },
        handler: async (req, res) => {
          res.send({ received: req.body.key });
        },
      });

      // 3. Raw Buffer Route (Simulating @axiomify/upload)
      app.route({
        method: 'POST',
        path: '/upload',
        handler: async (req, res) => {
          const isBuffer = Buffer.isBuffer(req.body);
          res.send({ isBuffer, size: (req.body as Buffer).length });
        },
      });

      // 4. Express Compatibility Bridge
      const dummyExpressMiddleware = (req: any, res: any, next: any) => {
        res.setHeader('X-Bridged', 'true');
        next();
      };

      app.route({
        method: 'GET',
        path: '/bridge',
        handler: async (req, res) => {
          await adaptMiddleware(dummyExpressMiddleware)(req, res);
          res.send({ bridged: true });
        },
      });

      adapter = new NativeAdapter(app, { port: PORT });
      // Use the callback we added to know exactly when the port is bound
      adapter.listen(() => resolve());
    });
  });

  afterAll(() => {
    // Teardown the C++ process so Vitest can exit
    adapter.close();
  });

  it('should process a high-speed GET request natively', async () => {
    const res = await fetch(`http://localhost:${PORT}/ping`);
    const data = await res.json();

    expect(res.status).toBe(200);
    // Assuming your serializer wraps responses, adjust if needed:
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
        // The server sends a welcome message, then echoes
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
