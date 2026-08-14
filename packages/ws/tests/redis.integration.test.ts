/**
 * @axiomify/ws — RedisWsBroker against a REAL Redis.
 *
 * Opt-in: skipped unless `REDIS_URL` is set (see test-helpers/mini-redis.ts
 * and CONTRIBUTING.md). `broker.test.ts` covers RedisWsBroker against
 * in-memory fake client pairs for both API styles — this file exercises
 * real PUBLISH/SUBSCRIBE, including the full RoomManager integration
 * (mirroring the `fakeWsClient`/`makeNode` harness in broker.test.ts) so
 * cross-node delivery is proven over an actual network round-trip, not a
 * same-process EventEmitter.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RedisWsBroker, RoomManager, type WsBroker } from '../src/index';
import { MiniRedis } from '../../../test-helpers/mini-redis';

const RUN = !!process.env.REDIS_URL;
const CH_PREFIX = `axiomify:ws:test:${process.pid}:${Date.now()}:`;
const flush = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms));

interface FakeWsClient {
  state: Record<string, unknown>;
  published: Array<[string, string | Buffer, boolean | undefined]>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  publish: (
    topic: string,
    payload: string | Buffer,
    isBinary?: boolean,
  ) => void;
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

function makeNode(broker: WsBroker, room?: string) {
  const manager = new RoomManager({ broker } as any);
  const ws = fakeWsClient();
  const client = manager._onOpen(ws as any);
  if (room) client.join(room);
  return { manager, ws, client };
}

describe.skipIf(!RUN)('RedisWsBroker (real Redis)', () => {
  const connections: MiniRedis[] = [];

  async function newBroker(): Promise<RedisWsBroker> {
    // A dedicated connection per pub AND per sub — Redis forbids ordinary
    // commands on a connection that has issued SUBSCRIBE.
    const pub = await MiniRedis.connect();
    const sub = await MiniRedis.connect();
    connections.push(pub, sub);
    return new RedisWsBroker({ pub, sub });
  }

  afterAll(async () => {
    await Promise.all(connections.map((c) => c.quit().catch(() => {})));
  });

  it('delivers a raw PUBLISH to a real subscriber', async () => {
    const a = await newBroker();
    const b = await newBroker();
    const channel = `${CH_PREFIX}raw`;

    const received: Array<[string | Buffer, string]> = [];
    await b.subscribe(channel, (payload, ch) => received.push([payload, ch]));
    await flush(); // let SUBSCRIBE round-trip to the server

    await a.publish(channel, 'hello');
    await flush();

    expect(received).toEqual([['hello', channel]]);
  });

  it('unsubscribe stops delivery', async () => {
    const a = await newBroker();
    const b = await newBroker();
    const channel = `${CH_PREFIX}unsub`;

    const received: string[] = [];
    await b.subscribe(channel, (p) => received.push(String(p)));
    await flush();

    await b.unsubscribe(channel);
    await flush();

    await a.publish(channel, 'late');
    await flush();

    expect(received).toEqual([]);
  });

  it('drives two RoomManagers end-to-end over real Redis', async () => {
    const room = `${CH_PREFIX}lobby`;
    const a = makeNode(await newBroker(), room);
    const b = makeNode(await newBroker(), room);
    await flush(); // room-channel SUBSCRIBE round-trip on node B

    a.manager.room(room)!.broadcast({ hello: 'world' });
    await flush();

    const remote = b.ws.published.filter(([topic]) => topic === room);
    expect(remote).toHaveLength(1);
    expect(String(remote[0][1])).toBe(JSON.stringify({ hello: 'world' }));

    const presence = await a.manager.getGlobalPresence(room);
    expect(presence).toEqual({ nodes: 2, total: 2 });

    a.manager.close();
    b.manager.close();
  }, 10_000);
});
