
import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import { WebSocket } from 'ws';

let uwsSupported = false;
try {
  require('uWebSockets.js');
  uwsSupported = true;
} catch {
  uwsSupported = false;
}

describe.skipIf(!uwsSupported)('NativeAdapter - WebSockets', () => {
  let app: any;
  let adapter: any;
  let PORT: number;

  beforeAll(async () => {
    const { Axiomify, z } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    app = new Axiomify();

    app.ws({
      path: '/chat',
      schema: {
        message: z.object({
          text: z.string(),
        }),
      },
      plugins: [
        async (req, res) => {
          if (req.headers['authorization'] !== 'Bearer secret') {
            res.status(401).send(null, 'Unauthorized');
          } else {
            req.state.user = { id: 1 };
          }
        },
      ],
      open: (client, req) => {
        client.send({ type: 'welcome', user: client.state.user.id });
      },
      message: (client, data: any) => {
        client.send({ type: 'echo', text: data.text });
      },
    });

    adapter = new NativeAdapter(app, { port: 0 });
    return new Promise<void>((resolve) => {
      adapter.listen((port) => {
        PORT = port;
        resolve();
      });
    });
  });

  afterAll(() => {
    adapter.close();
  });

  it('rejects unauthorized connections', () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/chat`);
      ws.on('unexpected-response', (req, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on('open', () => reject(new Error('Should not have opened')));
    });
  });

  it('accepts authorized connections and validates messages', () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/chat`, {
        headers: { authorization: 'Bearer secret' },
      });

      const messages: any[] = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);

        if (messages.length === 1) {
          expect(msg).toEqual({ type: 'welcome', user: 1 });
          ws.send(JSON.stringify({ text: 'hello world' }));
        } else if (messages.length === 2) {
          expect(msg).toEqual({ type: 'echo', text: 'hello world' });
          ws.send(JSON.stringify({ bad: 'invalid schema' }));
        } else if (messages.length === 3) {
          expect(msg.error).toBe('Invalid message');
          expect(msg.details.body).toBeDefined();
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  });

  it('registers custom WebSocket options correctly on the app', () => {
    app.ws({
      path: '/custom-opts',
      compression: 1,
      maxPayloadLength: 1024,
      idleTimeout: 30,
      open: () => {},
    });

    const route = app.registeredWsRoutes.find((r: any) => r.path === '/custom-opts');
    expect(route).toBeDefined();
    expect(route.compression).toBe(1);
    expect(route.maxPayloadLength).toBe(1024);
    expect(route.idleTimeout).toBe(30);
  });
});
