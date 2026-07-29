/**
 * @axiomify/ws — cross-process broker tests.
 *
 * Unlike the room integration suites, these tests need NO uWebSockets
 * binary: RoomManager is constructed directly and clients are registered
 * through `_onOpen()` with fake WsClient transports. "Delivery" is
 * observed via the fake's `publish()` calls (the uWS topic fan-out point).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createMemoryBrokerHub,
  MemoryWsBroker,
  RedisWsBroker,
  RoomManager,
  WS_CTL_CHANNEL,
  wsRoomChannel,
  type WsBroker,
} from '../src/index';

interface FakeWsClient {
  state: Record<string, unknown>;
  /** (topic, payload, isBinary) tuples — survives the manager's telemetry
   *  wrapper around `publish`, unlike a spy stored on the object itself. */
  published: Array<[string, string | Buffer, boolean | undefined]>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  publish: (topic: string, payload: string | Buffer, isBinary?: boolean) => void;
  getBufferedAmount: () => number;
}

function fakeWsClient(): FakeWsClient {
  const published: FakeWsClient['published'] = [];
  return {
    state: {},
    published,
    send: vi.fn(),
    close: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: (topic, payload, isBinary) => {
      published.push([topic, payload, isBinary]);
    },
    getBufferedAmount: () => 0,
  };
}

/** One simulated node: a manager + one connected client joined to `room`. */
function makeNode(broker: WsBroker, room?: string) {
  const manager = new RoomManager({ broker } as any);
  const ws = fakeWsClient();
  const client = manager._onOpen(ws as any);
  if (room) client.join(room);
  return { manager, ws, client };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('MemoryWsBroker + RoomManager integration', () => {
  it('delivers a broadcast to the other node exactly once', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub), 'lobby');
    const b = makeNode(new MemoryWsBroker(hub), 'lobby');
    await flush();

    a.manager.room('lobby')!.broadcast({ hello: 'world' });
    await flush();

    // Node B's transport publishes the remote payload into its local topic.
    const remoteDeliveries = b.ws.published.filter(
      ([topic]) => topic === 'lobby',
    );
    expect(remoteDeliveries).toHaveLength(1);
    expect(String(remoteDeliveries[0][1])).toBe(
      JSON.stringify({ hello: 'world' }),
    );
  });

  it('does not echo a node’s own broadcast back to it', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub), 'lobby');
    makeNode(new MemoryWsBroker(hub), 'lobby');
    await flush();

    a.ws.published.length = 0;
    a.manager.room('lobby')!.broadcast('ping');
    await flush();

    // Exactly the one LOCAL delivery — the self-published envelope coming
    // back through the hub is dropped by the nodeId check.
    const local = a.ws.published.filter(([t]) => t === 'lobby');
    expect(local).toHaveLength(1);
  });

  it('round-trips binary payloads via the base64 envelope', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub), 'bin');
    const b = makeNode(new MemoryWsBroker(hub), 'bin');
    await flush();

    const payload = Buffer.from([0x00, 0xff, 0x10, 0x80]);
    a.manager.room('bin')!.broadcast(payload, true);
    await flush();

    const remote = b.ws.published.filter(([t]) => t === 'bin');
    expect(remote).toHaveLength(1);
    expect(Buffer.from(remote[0][1])).toEqual(payload);
    expect(remote[0][2]).toBe(true);
  });

  it('refcounts the room channel subscription across join/leave', async () => {
    const hub = createMemoryBrokerHub();
    const broker = new MemoryWsBroker(hub);
    const subscribeSpy = vi.spyOn(broker, 'subscribe');
    const unsubscribeSpy = vi.spyOn(broker, 'unsubscribe');

    const manager = new RoomManager({ broker } as any);
    const c1 = manager._onOpen(fakeWsClient() as any);
    const c2 = manager._onOpen(fakeWsClient() as any);

    c1.join('lobby');
    c2.join('lobby');
    await flush();
    const roomSubs = subscribeSpy.mock.calls.filter(
      ([ch]) => ch === wsRoomChannel('lobby'),
    );
    expect(roomSubs).toHaveLength(1); // second join reuses the subscription

    c1.leave('lobby');
    await flush();
    expect(
      unsubscribeSpy.mock.calls.filter(([ch]) => ch === wsRoomChannel('lobby')),
    ).toHaveLength(0); // one local member remains

    c2.leave('lobby');
    await flush();
    expect(
      unsubscribeSpy.mock.calls.filter(([ch]) => ch === wsRoomChannel('lobby')),
    ).toHaveLength(1); // last member left → refcount hit zero
  });

  it('aggregates global presence across nodes', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub), 'stage');
    const b = makeNode(new MemoryWsBroker(hub), 'stage');
    const extra = b.manager._onOpen(fakeWsClient() as any);
    extra.join('stage');
    await flush();

    const presence = await a.manager.getGlobalPresence('stage');
    expect(presence).toEqual({ nodes: 2, total: 3 });
  });

  it('getGlobalPresence degrades to the local view without a broker', async () => {
    const manager = new RoomManager({} as any);
    const client = manager._onOpen(fakeWsClient() as any);
    client.join('solo');
    await expect(manager.getGlobalPresence('solo')).resolves.toEqual({
      nodes: 1,
      total: 1,
    });
  });

  it('a throwing broker never blocks local delivery and counts drops', async () => {
    const failing: WsBroker = {
      nodeId: 'failing-node',
      publish: vi.fn().mockRejectedValue(new Error('redis down')),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new RoomManager({ broker: failing } as any);
    const ws = fakeWsClient();
    const client = manager._onOpen(ws as any);
    client.join('lobby');
    await flush();

    manager.room('lobby')!.broadcast('still works');
    await flush();

    const local = ws.published.filter(([t]) => t === 'lobby');
    expect(local).toHaveLength(1); // local fan-out unaffected
    expect(manager.getStats().brokerDropped).toBeGreaterThan(0);
  });

  it('close() tears the broker down', async () => {
    const hub = createMemoryBrokerHub();
    const broker = new MemoryWsBroker(hub);
    const closeSpy = vi.spyOn(broker, 'close');
    const node = makeNode(broker, 'lobby');
    await flush();
    node.manager.close();
    await flush();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('broadcastAll() reaches clients on every node when a broker is configured', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub)); // no room — broadcastAll ignores rooms
    const b = makeNode(new MemoryWsBroker(hub));
    await flush();

    a.manager.broadcastAll({ hello: 'everyone' });
    await flush();

    // Local delivery on the sending node.
    expect(a.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ hello: 'everyone' }),
      undefined,
    );
    // Cross-node delivery via the broker's control channel — this is the
    // fix: broadcastAll() previously never reached other nodes.
    expect(b.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ hello: 'everyone' }),
      undefined,
    );
  });

  it('broadcastAll() does not double-deliver to the sending node’s own clients', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub));
    makeNode(new MemoryWsBroker(hub));
    await flush();

    a.manager.broadcastAll('ping');
    await flush();

    // Exactly one delivery locally — the self-published control message
    // coming back through the hub must be dropped by the nodeId check.
    expect(a.ws.send).toHaveBeenCalledTimes(1);
  });

  it('broadcastAll() round-trips binary payloads across nodes', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub));
    const b = makeNode(new MemoryWsBroker(hub));
    await flush();

    const payload = Buffer.from([0x01, 0x02, 0x03]);
    a.manager.broadcastAll(payload, true);
    await flush();

    expect(b.ws.send).toHaveBeenCalledTimes(1);
    const [receivedData, receivedIsBinary] = b.ws.send.mock.calls[0];
    expect(Buffer.from(receivedData)).toEqual(payload);
    expect(receivedIsBinary).toBe(true);
  });

  it('broadcastAll() without a broker only reaches the local node (unchanged behavior)', async () => {
    const manager = new RoomManager({} as any);
    const ws = fakeWsClient();
    manager._onOpen(ws as any);
    manager.broadcastAll('local-only');
    await flush();
    expect(ws.send).toHaveBeenCalledWith('local-only', undefined);
  });
});

// ─── RedisWsBroker against fake clients (both client API styles) ─────────────

/** Shared in-memory "Redis" channel bus for the fake client pairs. */
function makeBus() {
  return new EventEmitter();
}

/** ioredis style: subscribe(channel) + on('message', (channel, message)). */
function ioredisPair(bus: EventEmitter) {
  const listeners = new EventEmitter();
  const sub = {
    subscribe: vi.fn(async (channel: string) => {
      bus.on(channel, (message: string) =>
        listeners.emit('message', channel, message),
      );
    }),
    unsubscribe: vi.fn(async (_channel: string) => {}),
    on: (event: string, handler: (...args: any[]) => void) => {
      listeners.on(event, handler);
    },
  };
  const pub = {
    publish: vi.fn(async (channel: string, message: string) => {
      bus.emit(channel, message);
    }),
  };
  return { pub, sub };
}

/** node-redis v4 style: subscribe(channel, listener). */
function nodeRedisPair(bus: EventEmitter) {
  const sub = {
    subscribe: vi.fn(
      async (channel: string, listener: (message: string) => void) => {
        bus.on(channel, listener);
      },
    ),
    unsubscribe: vi.fn(async (_channel: string) => {}),
  };
  const pub = {
    publish: vi.fn(async (channel: string, message: string) => {
      bus.emit(channel, message);
    }),
  };
  return { pub, sub };
}

describe.each([
  ['ioredis-style', ioredisPair],
  ['node-redis-v4-style', nodeRedisPair],
])('RedisWsBroker (%s clients)', (_label, makePair) => {
  let bus: EventEmitter;

  beforeEach(() => {
    bus = makeBus();
  });
  afterEach(() => {
    bus.removeAllListeners();
  });

  it('publishes and receives on a channel', async () => {
    const brokerA = new RedisWsBroker(makePair(bus) as any);
    const brokerB = new RedisWsBroker(makePair(bus) as any);

    const received: string[] = [];
    await brokerB.subscribe('axiomify:ws:room:lobby', (payload) => {
      received.push(String(payload));
    });
    await brokerA.publish('axiomify:ws:room:lobby', 'hello');
    await flush();

    expect(received).toEqual(['hello']);
  });

  it('exposes a distinct nodeId per broker instance', () => {
    const a = new RedisWsBroker(makePair(bus) as any);
    const b = new RedisWsBroker(makePair(bus) as any);
    expect(a.nodeId).toBeTruthy();
    expect(a.nodeId).not.toBe(b.nodeId);
  });

  it('unsubscribe stops delivery to the handler', async () => {
    const broker = new RedisWsBroker(makePair(bus) as any);
    const received: string[] = [];
    await broker.subscribe('ch', (p) => received.push(String(p)));
    await broker.unsubscribe('ch');
    bus.emit('ch', 'late');
    await flush();
    expect(received).toEqual([]);
  });

  it('drives two RoomManagers end-to-end', async () => {
    const a = makeNode(new RedisWsBroker(makePair(bus) as any), 'lobby');
    const b = makeNode(new RedisWsBroker(makePair(bus) as any), 'lobby');
    await flush();

    a.manager.room('lobby')!.broadcast({ n: 1 });
    await flush();

    const remote = b.ws.published.filter(([t]) => t === 'lobby');
    expect(remote).toHaveLength(1);
    expect(String(remote[0][1])).toBe(JSON.stringify({ n: 1 }));

    const presence = await a.manager.getGlobalPresence('lobby');
    expect(presence).toEqual({ nodes: 2, total: 2 });
  });

  it('close() resolves', async () => {
    const broker = new RedisWsBroker(makePair(bus) as any);
    await expect(broker.close()).resolves.toBeUndefined();
  });

  it('forwards wire-protocol room messages across the broker to other nodes', async () => {
    const hub = createMemoryBrokerHub();
    const a = makeNode(new MemoryWsBroker(hub), 'lobby');
    const b = makeNode(new MemoryWsBroker(hub), 'lobby');
    await flush();

    a.manager._processAction(a.client.id, {
      action: 'message',
      room: 'lobby',
      data: 'cluster-wide payload',
    });
    await flush();

    const remote = b.ws.published.filter(([t]) => t === 'lobby');
    expect(remote).toHaveLength(1);
    const envelope = JSON.parse(String(remote[0][1]));
    expect(envelope).toEqual({
      event: 'message',
      room: 'lobby',
      from: a.client.id,
      data: 'cluster-wide payload',
    });
  });
});
