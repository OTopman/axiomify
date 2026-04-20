import EventEmitter from 'events';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WsManager } from '../src/index';

/**
 * The WsManager had the lowest coverage (~39%) because the existing suite
 * only drove upgrade + message-size-limit. This suite walks every path
 * inside the `on('connection', ...)` handler:
 *   - text messages with and without a schema
 *   - binary frames routed to onBinary (regression: used to be JSON.parse'd)
 *   - malformed JSON surfaces 'Malformed payload' back to the client
 *   - schema validation rejects and sends back the Zod formatted error
 *   - rooms: join, broadcast, leave-on-close, getStats
 *   - heartbeat: calls ping; terminates when pong is too stale
 */

function makeClient() {
  const c: any = new EventEmitter();
  c.send = vi.fn();
  c.close = vi.fn();
  c.terminate = vi.fn();
  c.ping = vi.fn();
  c.readyState = 1; // ws.OPEN
  return c;
}

describe('WsManager — connection handler', () => {
  it('dispatches text messages to the registered event handler', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0, // disable heartbeat for this test
    });

    const handler = vi.fn();
    manager.on('chat:say', null, handler);

    const client = makeClient();
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    const payload = Buffer.from(
      JSON.stringify({ event: 'chat:say', data: { text: 'hi' } }),
      'utf8',
    );
    client.emit('message', payload, false);

    expect(handler).toHaveBeenCalledWith(client, { text: 'hi' });
  });

  it('ignores messages whose event is not registered', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
    });

    const handler = vi.fn();
    manager.on('known', null, handler);

    const client = makeClient();
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    const payload = Buffer.from(
      JSON.stringify({ event: 'unknown', data: {} }),
      'utf8',
    );
    client.emit('message', payload, false);

    expect(handler).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled(); // no error shouted back either
  });

  it('validates text messages against the registered Zod schema', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
    });

    const handler = vi.fn();
    manager.on('chat:say', z.object({ text: z.string().min(1) }), handler);

    const client = makeClient();
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    // Valid payload
    client.emit(
      'message',
      Buffer.from(JSON.stringify({ event: 'chat:say', data: { text: 'hi' } })),
      false,
    );
    expect(handler).toHaveBeenCalledTimes(1);

    // Invalid payload (missing text) — the handler must NOT be invoked and
    // the client should receive a validation error.
    client.send.mockClear();
    client.emit(
      'message',
      Buffer.from(JSON.stringify({ event: 'chat:say', data: {} })),
      false,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith(
      expect.stringContaining('Validation failed'),
    );
  });

  it('sends "Malformed payload" on invalid JSON', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
    });

    const client = makeClient();
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    client.emit('message', Buffer.from('not json at all'), false);
    expect(client.send).toHaveBeenCalledWith(
      expect.stringContaining('Malformed payload'),
    );
  });

  it('routes binary frames to onBinary, not through JSON.parse', () => {
    // Regression: previously, binary data fell into the JSON branch and
    // produced a bogus "Malformed payload" response for every real binary
    // frame.
    const onBinary = vi.fn();
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
      onBinary,
    });

    const client = makeClient();
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    client.emit('message', buf, true);

    expect(onBinary).toHaveBeenCalledWith(client, buf);
    expect(client.send).not.toHaveBeenCalled(); // no JSON error emitted
  });

  it('ignores binary frames silently when no onBinary handler is configured', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
    });

    const client = makeClient();
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    client.emit('message', Buffer.from([0xff]), true);
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('WsManager — rooms', () => {
  it('joins, broadcasts to members, and leaves on close', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
    });

    // The upgrade path sets id/rooms/user and registers the client in the
    // manager's client map. We bypass that path, so do it by hand here.
    const wire = (c: any, id: string) => {
      c.id = id;
      c.rooms = new Set<string>();
      (manager as any).clients.set(id, c);
      (manager as any).wss.emit('connection', c, { url: '/ws' });
    };

    const a = makeClient();
    const b = makeClient();
    const c = makeClient();
    wire(a, 'a');
    wire(b, 'b');
    wire(c, 'c');

    manager.joinRoom(a, 'room-1');
    manager.joinRoom(b, 'room-1');
    // c is not in room-1

    manager.broadcastToRoom('room-1', 'ping', { n: 42 });

    expect(a.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'ping', data: { n: 42 } }),
    );
    expect(b.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'ping', data: { n: 42 } }),
    );
    expect(c.send).not.toHaveBeenCalled();

    // Stats reflect one room with two members.
    expect(manager.getStats().rooms).toEqual({ 'room-1': 2 });

    // On close, `a` is removed from both the client map and its rooms.
    a.emit('close');
    expect(manager.getStats().connectedClients).toBe(2);
    expect(manager.getStats().rooms).toEqual({ 'room-1': 1 });

    // Leaving the last member drops the room entirely.
    b.emit('close');
    expect(manager.getStats().rooms).toEqual({});
  });

  it('does not crash broadcasting to an empty room', () => {
    const manager = new WsManager({
      server: { on: vi.fn() } as any,
      heartbeatIntervalMs: 0,
    });
    // Should silently no-op.
    expect(() => manager.broadcastToRoom('ghost', 'ping', {})).not.toThrow();
  });
});

describe('WsManager — heartbeat', () => {
  it('pings live clients and terminates stale ones', () => {
    vi.useFakeTimers();
    try {
      const manager = new WsManager({
        server: { on: vi.fn() } as any,
        heartbeatIntervalMs: 10,
      });

      const client = makeClient();
      (manager as any).wss.emit('connection', client, { url: '/ws' });

      // First tick: client has just connected, lastPong is now, so we ping.
      vi.advanceTimersByTime(11);
      expect(client.ping).toHaveBeenCalled();

      // Advance past 2 * heartbeatInterval with no pong — the client should
      // be terminated on the next tick.
      vi.advanceTimersByTime(50);
      expect(client.terminate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
