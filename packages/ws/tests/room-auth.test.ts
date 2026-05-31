import { describe, it, expect, afterAll, beforeAll, afterEach } from 'vitest';
import { WebSocket } from 'ws';

let uwsSupported = false;
try {
  require('uWebSockets.js');
  uwsSupported = true;
} catch {
  uwsSupported = false;
}

interface TestWebSocket extends WebSocket {
  queue: any[];
  resolvers: ((val: any) => void)[];
}

function connectWs(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`, {
      headers,
    }) as TestWebSocket;
    ws.queue = [];
    ws.resolvers = [];

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (ws.resolvers.length > 0) {
        const resolveMsg = ws.resolvers.shift()!;
        resolveMsg(msg);
      } else {
        ws.queue.push(msg);
      }
    });

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  const tws = ws as TestWebSocket;
  if (tws.queue.length > 0) {
    return Promise.resolve(tws.queue.shift());
  }
  return new Promise((resolve) => {
    tws.resolvers.push(resolve);
  });
}

async function sendAction(ws: WebSocket, action: object): Promise<any> {
  const promise = nextMessage(ws);
  ws.send(JSON.stringify(action));
  return promise;
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on('close', () => resolve());
    ws.close();
  });
}

describe.skipIf(!uwsSupported)('@axiomify/ws - Room Authorization', () => {
  let app: any;
  let adapter: any;
  let rooms: any;
  let PORT: number;

  afterEach(async () => {
    if (adapter) {
      adapter.close();
      adapter = null;
    }
  });

  const setupApp = async (options: any) => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('@axiomify/native');
    const { wsRooms } = await import('../src/index');

    app = new Axiomify();
    PORT = 10000 + Math.floor(Math.random() * 5000);

    rooms = wsRooms(app, {
      path: '/ws',
      ...options,
    });

    adapter = new NativeAdapter(app, { port: PORT });
    await new Promise<void>((resolve) => {
      adapter.listen(() => resolve());
    });
  };

  it('should default deny all joins when neither beforeJoin nor allowlist is specified', async () => {
    await setupApp({});
    const ws = await connectWs(PORT, '/ws');
    const res = await sendAction(ws, { action: 'join', room: 'room-1' });
    expect(res).toEqual({ error: 'Unauthorized', code: 'ROOM_JOIN_FORBIDDEN' });
    await closeWs(ws);
  });

  it('should allow joins matching the allowlist pattern', async () => {
    await setupApp({
      allowlist: /^public-.*$/,
    });
    const ws = await connectWs(PORT, '/ws');

    // public-1 matches and should succeed
    const res1 = await sendAction(ws, { action: 'join', room: 'public-1' });
    expect(res1).toEqual({ event: 'joined', room: 'public-1' });

    // private-1 does not match and should fail
    const res2 = await sendAction(ws, { action: 'join', room: 'private-1' });
    expect(res2).toEqual({
      error: 'Unauthorized',
      code: 'ROOM_JOIN_FORBIDDEN',
    });

    await closeWs(ws);
  });

  it('should evaluate beforeJoin callback and allow/deny accordingly', async () => {
    await setupApp({
      beforeJoin: (client: any, room: string) => {
        return room.startsWith('allowed-');
      },
    });
    const ws = await connectWs(PORT, '/ws');

    const res1 = await sendAction(ws, { action: 'join', room: 'allowed-room' });
    expect(res1).toEqual({ event: 'joined', room: 'allowed-room' });

    const res2 = await sendAction(ws, { action: 'join', room: 'denied-room' });
    expect(res2).toEqual({
      error: 'Unauthorized',
      code: 'ROOM_JOIN_FORBIDDEN',
    });

    await closeWs(ws);
  });

  it('should support async beforeJoin callback', async () => {
    await setupApp({
      beforeJoin: async (client: any, room: string) => {
        await new Promise((r) => setTimeout(r, 10));
        return room === 'async-ok';
      },
    });
    const ws = await connectWs(PORT, '/ws');

    const res1 = await sendAction(ws, { action: 'join', room: 'async-ok' });
    expect(res1).toEqual({ event: 'joined', room: 'async-ok' });

    const res2 = await sendAction(ws, { action: 'join', room: 'async-fail' });
    expect(res2).toEqual({
      error: 'Unauthorized',
      code: 'ROOM_JOIN_FORBIDDEN',
    });

    await closeWs(ws);
  });

  it('should deny if beforeJoin callback throws an error', async () => {
    await setupApp({
      beforeJoin: () => {
        throw new Error('Some validation failure');
      },
    });
    const ws = await connectWs(PORT, '/ws');

    const res = await sendAction(ws, { action: 'join', room: 'any-room' });
    expect(res).toEqual({ error: 'Unauthorized', code: 'ROOM_JOIN_FORBIDDEN' });

    await closeWs(ws);
  });
});
