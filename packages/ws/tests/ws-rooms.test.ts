/**
 * @axiomify/ws — Integration tests.
 *
 * These tests require uWebSockets.js native binaries. On platforms where
 * uWS is not available (e.g. CI on unsupported Node versions), the entire
 * suite is skipped — same pattern as packages/native/tests/ws.test.ts.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
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

/**
 * Helper: connect a ws client and wait for it to open.
 */
function connectWs(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`, { headers }) as TestWebSocket;
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

/**
 * Helper: wait for the next message from a ws client.
 */
function nextMessage(ws: WebSocket): Promise<any> {
  const tws = ws as TestWebSocket;
  if (tws.queue.length > 0) {
    return Promise.resolve(tws.queue.shift());
  }
  return new Promise((resolve) => {
    tws.resolvers.push(resolve);
  });
}

/**
 * Helper: send a JSON action and wait for the response.
 */
async function sendAction(ws: WebSocket, action: object): Promise<any> {
  const promise = nextMessage(ws);
  ws.send(JSON.stringify(action));
  return promise;
}

/**
 * Helper: close a ws client and wait for it to fully close.
 */
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

describe.skipIf(!uwsSupported)('@axiomify/ws - Room Manager', () => {
  let app: any;
  let adapter: any;
  let rooms: any;
  let PORT: number;

  beforeAll(async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('@axiomify/native');
    const { wsRooms } = await import('../src/index');

    app = new Axiomify();

    rooms = wsRooms(app, {
      path: '/chat',
      maxRoomsPerClient: 3,
      presenceIntervalMs: 0, // disable for tests
      plugins: [
        async (req, res) => {
          const auth = req.headers['authorization'];
          if (auth === 'Bearer reject-me') {
            res.status(401).send(null, 'Unauthorized');
          } else {
            req.state.user = { name: auth ?? 'anonymous' };
          }
        },
      ],
      onConnect(client: any) {
        client.send({ event: 'welcome', id: client.id });
      },
    });

    adapter = new NativeAdapter(app, { port: 0 });

    return new Promise<void>((resolve) => {
      adapter.listen((port: number) => {
        PORT = port;
        resolve();
      });
    });
  });

  afterAll(() => {
    rooms.close();
    adapter.close();
  });

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  it('sends a welcome message on connect', async () => {
    const ws = await connectWs(PORT, '/chat');
    const msg = await nextMessage(ws);
    expect(msg.event).toBe('welcome');
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe('string');
    await closeWs(ws);
  });

  it('rejects unauthorized connections', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/chat`, {
        headers: { authorization: 'Bearer reject-me' },
      });
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on('open', () => reject(new Error('Should not have opened')));
    });
  });

  // -------------------------------------------------------------------------
  // Wire protocol: join / leave
  // -------------------------------------------------------------------------

  it('joins a room via wire protocol', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    const response = await sendAction(ws, { action: 'join', room: 'lobby' });
    expect(response).toEqual({ event: 'joined', room: 'lobby' });

    expect(rooms.room('lobby')).toBeDefined();
    expect(rooms.room('lobby')?.size).toBe(1);

    await closeWs(ws);
  });

  it('leaves a room via wire protocol', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    await sendAction(ws, { action: 'join', room: 'temp-room' });

    const response = await sendAction(ws, { action: 'leave', room: 'temp-room' });
    expect(response).toEqual({ event: 'left', room: 'temp-room' });

    // Room should be destroyed (last member left).
    expect(rooms.room('temp-room')).toBeUndefined();

    await closeWs(ws);
  });

  // -------------------------------------------------------------------------
  // Room lifecycle: create on join, destroy on last leave
  // -------------------------------------------------------------------------

  it('destroys room immediately on last client leave', async () => {
    const ws1 = await connectWs(PORT, '/chat');
    const ws2 = await connectWs(PORT, '/chat');
    await nextMessage(ws1); // welcome
    await nextMessage(ws2); // welcome

    await sendAction(ws1, { action: 'join', room: 'ephemeral' });
    await sendAction(ws2, { action: 'join', room: 'ephemeral' });
    expect(rooms.room('ephemeral')?.size).toBe(2);

    await sendAction(ws1, { action: 'leave', room: 'ephemeral' });
    expect(rooms.room('ephemeral')?.size).toBe(1);

    await sendAction(ws2, { action: 'leave', room: 'ephemeral' });
    expect(rooms.room('ephemeral')).toBeUndefined();

    await closeWs(ws1);
    await closeWs(ws2);
  });

  it('cleans up rooms when client disconnects', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    await sendAction(ws, { action: 'join', room: 'disconnect-test' });
    expect(rooms.room('disconnect-test')).toBeDefined();

    await closeWs(ws);

    // Give the close handler a tick to process.
    await new Promise((r) => setTimeout(r, 50));

    expect(rooms.room('disconnect-test')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  it('broadcasts messages to room members', async () => {
    const ws1 = await connectWs(PORT, '/chat');
    const ws2 = await connectWs(PORT, '/chat');
    const ws3 = await connectWs(PORT, '/chat'); // NOT in room
    await nextMessage(ws1);
    await nextMessage(ws2);
    await nextMessage(ws3);

    await sendAction(ws1, { action: 'join', room: 'broadcast-test' });
    await sendAction(ws2, { action: 'join', room: 'broadcast-test' });

    // ws3 does NOT join

    // Set up message listeners BEFORE sending
    const ws2Promise = nextMessage(ws2);
    const ws1Promise = nextMessage(ws1);

    // Send a message via wire protocol
    ws1.send(JSON.stringify({
      action: 'message',
      room: 'broadcast-test',
      data: { text: 'hello room' },
    }));

    // Both ws1 and ws2 should receive the broadcast
    const msg1 = await ws1Promise;
    const msg2 = await ws2Promise;

    expect(msg1.event).toBe('message');
    expect(msg1.room).toBe('broadcast-test');
    expect(msg1.data).toEqual({ text: 'hello room' });

    expect(msg2.event).toBe('message');
    expect(msg2.room).toBe('broadcast-test');
    expect(msg2.data).toEqual({ text: 'hello room' });

    await closeWs(ws1);
    await closeWs(ws2);
    await closeWs(ws3);
  });

  // -------------------------------------------------------------------------
  // Max rooms per client
  // -------------------------------------------------------------------------

  it('enforces maxRoomsPerClient limit', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    // maxRoomsPerClient is 3 in our test config
    await sendAction(ws, { action: 'join', room: 'limit-1' });
    await sendAction(ws, { action: 'join', room: 'limit-2' });
    await sendAction(ws, { action: 'join', room: 'limit-3' });

    // 4th room should fail
    const response = await sendAction(ws, { action: 'join', room: 'limit-4' });
    expect(response.event).toBe('error');
    expect(response.code).toBe('JOIN_FAILED');
    expect(response.message).toContain('Room limit exceeded');

    await closeWs(ws);
  });

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  it('returns presence data via wire protocol', async () => {
    const ws1 = await connectWs(PORT, '/chat', { authorization: 'Alice' });
    const ws2 = await connectWs(PORT, '/chat', { authorization: 'Bob' });
    await nextMessage(ws1);
    await nextMessage(ws2);

    await sendAction(ws1, { action: 'join', room: 'presence-test' });
    await sendAction(ws2, { action: 'join', room: 'presence-test' });

    const response = await sendAction(ws1, { action: 'presence', room: 'presence-test' });
    expect(response.event).toBe('presence');
    expect(response.room).toBe('presence-test');
    expect(response.clients).toHaveLength(2);
    expect(response.clients[0].id).toBeDefined();
    expect(response.clients[0].joinedAt).toBeDefined();
    expect(typeof response.clients[0].joinedAt).toBe('number');

    await closeWs(ws1);
    await closeWs(ws2);
  });

  // -------------------------------------------------------------------------
  // Multiple rooms
  // -------------------------------------------------------------------------

  it('client can join multiple rooms', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    await sendAction(ws, { action: 'join', room: 'multi-a' });
    await sendAction(ws, { action: 'join', room: 'multi-b' });

    expect(rooms.room('multi-a')?.has).toBeDefined();
    expect(rooms.room('multi-b')?.has).toBeDefined();

    await closeWs(ws);
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it('returns error for invalid room name', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    const response = await sendAction(ws, { action: 'join', room: '' });
    expect(response.event).toBe('error');
    expect(response.code).toBe('INVALID_ROOM');

    await closeWs(ws);
  });

  it('returns error when messaging a non-existent room', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws); // welcome

    const response = await sendAction(ws, {
      action: 'message',
      room: 'ghost-room',
      data: { text: 'hello' },
    });
    expect(response.event).toBe('error');
    expect(response.code).toBe('ROOM_NOT_FOUND');

    await closeWs(ws);
  });

  it('returns error when messaging a room client is not in', async () => {
    const ws1 = await connectWs(PORT, '/chat');
    const ws2 = await connectWs(PORT, '/chat');
    await nextMessage(ws1);
    await nextMessage(ws2);

    // ws1 creates the room
    await sendAction(ws1, { action: 'join', room: 'exclusive' });

    // ws2 tries to message without joining
    const response = await sendAction(ws2, {
      action: 'message',
      room: 'exclusive',
      data: { text: 'sneaky' },
    });
    expect(response.event).toBe('error');
    expect(response.code).toBe('NOT_MEMBER');

    await closeWs(ws1);
    await closeWs(ws2);
  });

  // -------------------------------------------------------------------------
  // RoomManager API
  // -------------------------------------------------------------------------

  it('tracks client count correctly', async () => {
    const before = rooms.clientCount;

    const ws1 = await connectWs(PORT, '/chat');
    const ws2 = await connectWs(PORT, '/chat');
    await nextMessage(ws1);
    await nextMessage(ws2);

    expect(rooms.clientCount).toBe(before + 2);

    await closeWs(ws1);
    await closeWs(ws2);

    await new Promise((r) => setTimeout(r, 50));
    expect(rooms.clientCount).toBe(before);
  });

  it('emits join and leave events', async () => {
    const events: string[] = [];

    const onJoin = (roomName: string) => events.push(`join:${roomName}`);
    const onLeave = (roomName: string) => events.push(`leave:${roomName}`);

    rooms.on('join', onJoin);
    rooms.on('leave', onLeave);

    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws);

    await sendAction(ws, { action: 'join', room: 'event-test' });
    await sendAction(ws, { action: 'leave', room: 'event-test' });

    expect(events).toContain('join:event-test');
    expect(events).toContain('leave:event-test');

    rooms.off('join', onJoin);
    rooms.off('leave', onLeave);

    await closeWs(ws);
  });

  it('emits roomCreate and roomDelete events', async () => {
    const events: string[] = [];

    const onCreate = (name: string) => events.push(`create:${name}`);
    const onDelete = (name: string) => events.push(`delete:${name}`);

    rooms.on('roomCreate', onCreate);
    rooms.on('roomDelete', onDelete);

    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws);

    await sendAction(ws, { action: 'join', room: 'lifecycle-room' });
    await sendAction(ws, { action: 'leave', room: 'lifecycle-room' });

    expect(events).toContain('create:lifecycle-room');
    expect(events).toContain('delete:lifecycle-room');

    rooms.off('roomCreate', onCreate);
    rooms.off('roomDelete', onDelete);

    await closeWs(ws);
  });

  // -------------------------------------------------------------------------
  // Idempotent operations
  // -------------------------------------------------------------------------

  it('joining the same room twice is idempotent', async () => {
    const ws = await connectWs(PORT, '/chat');
    await nextMessage(ws);

    await sendAction(ws, { action: 'join', room: 'idempotent' });
    await sendAction(ws, { action: 'join', room: 'idempotent' });

    expect(rooms.room('idempotent')?.size).toBe(1);

    await closeWs(ws);
  });
});
