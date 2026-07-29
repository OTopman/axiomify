/**
 * @axiomify/ws — Cross-process broadcast brokers.
 *
 * uWebSockets.js topic pub/sub is per-process: a `room.broadcast()` only
 * reaches sockets connected to THIS worker. Under the framework's
 * `listenClustered()` (SO_REUSEPORT — one uWS app per worker, kernel-level
 * connection distribution), two clients in the same logical room can land
 * on different workers and never see each other's messages.
 *
 * A `WsBroker` bridges that gap. When a broker is passed to
 * `wsRooms(app, { broker })`:
 *
 *   1. Every local room broadcast is ALSO published to the broker on
 *      `axiomify:ws:room:<room>`.
 *   2. Messages received from the broker are re-broadcast into the local
 *      uWS topic — through a path that never re-forwards to the broker,
 *      so there are no echo loops.
 *   3. Presence queries can be answered cluster-wide over the control
 *      channel `axiomify:ws:ctl` (see `RoomManager.getGlobalPresence()`).
 *
 * Two implementations ship with the package:
 *
 *   - `RedisWsBroker` — production. BYO Redis clients (ioredis or redis@4),
 *     zero new dependencies.
 *   - `MemoryWsBroker` — in-process EventEmitter hub. Semantic parity with
 *     Redis pub/sub (including self-delivery); used for tests and
 *     single-process setups that want the same code path.
 */
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Channel naming
// ---------------------------------------------------------------------------

/** Prefix for per-room broadcast channels. */
export const WS_ROOM_CHANNEL_PREFIX = 'axiomify:ws:room:';

/** Control channel used for cross-node coordination (presence queries). */
export const WS_CTL_CHANNEL = 'axiomify:ws:ctl';

/** Build the broker channel name for a room. */
export function wsRoomChannel(room: string): string {
  return `${WS_ROOM_CHANNEL_PREFIX}${room}`;
}

// ---------------------------------------------------------------------------
// WsBroker interface
// ---------------------------------------------------------------------------

/** Handler invoked for every message received on a subscribed channel. */
export type WsBrokerMessageHandler = (
  payload: string | Buffer,
  channel: string,
) => void;

/**
 * Pluggable cross-process pub/sub transport for `@axiomify/ws`.
 *
 * Semantics (matching Redis pub/sub, which `RedisWsBroker` delegates to):
 *   - Fire-and-forget, at-most-once delivery. No persistence, no replay.
 *   - A publisher that is also subscribed to a channel RECEIVES its own
 *     messages. The RoomManager filters those out by `nodeId` — brokers
 *     must not attempt their own self-filtering.
 *   - `subscribe()` is idempotent per channel: the last handler wins.
 */
export interface WsBroker {
  /** Unique identifier for this node/process. Used to drop self-published messages. */
  readonly nodeId: string;

  /** Publish a payload to a channel. */
  publish(channel: string, payload: string | Buffer): Promise<void>;

  /** Subscribe to a channel. Messages are delivered to `handler`. */
  subscribe(channel: string, handler: WsBrokerMessageHandler): Promise<void>;

  /** Unsubscribe from a channel and stop delivering messages for it. */
  unsubscribe(channel: string): Promise<void>;

  /** Tear down all subscriptions. Idempotent. */
  close(): Promise<void>;
}

/**
 * Wire envelope published on `axiomify:ws:room:<room>` channels.
 *
 * `data` carries the exact frame payload: raw string for text payloads,
 * base64 when `binary` is true (Buffers can't survive JSON). `isBinary`
 * preserves the original WebSocket frame flag independently of the
 * transport encoding.
 */
export interface WsBrokerEnvelope {
  /** Publishing node — receivers drop envelopes with their own nodeId. */
  nodeId: string;
  /** Target room name (also encoded in the channel; kept for validation). */
  room: string;
  /** Envelope kind. Currently only 'broadcast'. */
  event: 'broadcast';
  /** Payload — raw string, or base64 when `binary` is true. */
  data: string;
  /** True when `data` is base64-encoded binary. */
  binary?: boolean;
  /** Original WebSocket frame flag to replay on the remote side. */
  isBinary?: boolean;
}

/** Control-channel messages exchanged on `axiomify:ws:ctl`. */
export type WsBrokerControlMessage =
  | { nodeId: string; type: 'presence:query'; id: string; room: string }
  | {
      nodeId: string;
      type: 'presence:reply';
      id: string;
      room: string;
      clients: Array<{
        id: string;
        state: Record<string, any>;
        joinedAt: number;
      }>;
    }
  | {
      nodeId: string;
      type: 'broadcast:all';
      id: string;
      data: string;
      /** Present (true) when `data` is base64 — Buffers don't survive JSON. */
      binary?: boolean;
      /** Original frame flag `RoomManager.broadcastAll()` was called with. */
      isBinary?: boolean;
    };

// ---------------------------------------------------------------------------
// Node ID generation
// ---------------------------------------------------------------------------

function generateNodeId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return require('node:crypto').randomUUID();
  } catch {
    return `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}

export interface WsBrokerOptions {
  /**
   * Stable identifier for this node. Defaults to a random UUID per broker
   * instance — override only if you need deterministic node names in
   * presence output.
   */
  nodeId?: string;
}

// ---------------------------------------------------------------------------
// MemoryWsBroker
// ---------------------------------------------------------------------------

/**
 * In-process broker backed by a shared EventEmitter "hub".
 *
 * Multiple `MemoryWsBroker` instances constructed with the SAME hub see
 * each other's messages — this is how tests simulate a multi-worker
 * cluster inside one process. Like Redis pub/sub, a broker receives its
 * own publications on channels it is subscribed to; the RoomManager
 * drops those by `nodeId`.
 *
 * Delivery is asynchronous (microtask) to mirror real transports.
 *
 * ```ts
 * const hub = createMemoryBrokerHub();
 * const brokerA = new MemoryWsBroker(hub);
 * const brokerB = new MemoryWsBroker(hub);
 * ```
 */
export function createMemoryBrokerHub(): EventEmitter {
  const hub = new EventEmitter();
  // A hub fans out to arbitrarily many brokers × channels.
  hub.setMaxListeners(0);
  return hub;
}

export class MemoryWsBroker implements WsBroker {
  public readonly nodeId: string;

  private readonly _hub: EventEmitter;
  private readonly _listeners = new Map<
    string,
    (payload: string | Buffer) => void
  >();
  private _closed = false;

  constructor(hub?: EventEmitter, options: WsBrokerOptions = {}) {
    this._hub = hub ?? createMemoryBrokerHub();
    this.nodeId = options.nodeId ?? generateNodeId();
  }

  async publish(channel: string, payload: string | Buffer): Promise<void> {
    if (this._closed) {
      throw new Error('[axiomify/ws] MemoryWsBroker is closed');
    }
    // Asynchronous delivery — mirrors network transports and avoids
    // re-entrant handler execution inside the publisher's call stack.
    queueMicrotask(() => {
      this._hub.emit(channel, payload);
    });
  }

  async subscribe(
    channel: string,
    handler: WsBrokerMessageHandler,
  ): Promise<void> {
    if (this._closed) {
      throw new Error('[axiomify/ws] MemoryWsBroker is closed');
    }
    // Idempotent per channel: replace any previous handler.
    this._detach(channel);
    const listener = (payload: string | Buffer) => handler(payload, channel);
    this._listeners.set(channel, listener);
    this._hub.on(channel, listener);
  }

  async unsubscribe(channel: string): Promise<void> {
    this._detach(channel);
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    for (const channel of Array.from(this._listeners.keys())) {
      this._detach(channel);
    }
  }

  private _detach(channel: string): void {
    const listener = this._listeners.get(channel);
    if (listener) {
      this._hub.off(channel, listener);
      this._listeners.delete(channel);
    }
  }
}

// ---------------------------------------------------------------------------
// RedisWsBroker
// ---------------------------------------------------------------------------

/**
 * Minimal duck-typed Redis client surfaces, compatible with both `ioredis`
 * and `redis@4` (node-redis) — mirroring `@axiomify/rate-limit`'s BYO-client
 * approach. No Redis dependency is added; you inject your own clients.
 */
export interface RedisPubLike {
  publish(channel: string, message: string | Buffer): Promise<unknown> | unknown;
}

export interface RedisSubLike {
  // ioredis:   subscribe(channel) + on('message', (channel, message) => …)
  // redis@4:   subscribe(channel, (message, channel) => …)
  subscribe(...args: any[]): Promise<unknown> | unknown;
  unsubscribe(...args: any[]): Promise<unknown> | unknown;
  // ioredis message events (also used for API detection).
  on?(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  // Detection markers (never called): ioredis exposes lowercase psubscribe,
  // node-redis v4 exposes camelCase pSubscribe.
  psubscribe?: unknown;
  pSubscribe?: unknown;
}

export interface RedisWsBrokerClients {
  /** Client used for PUBLISH. Must NOT be in subscriber mode. */
  pub: RedisPubLike;
  /**
   * DEDICATED subscriber connection. Redis puts a connection into
   * subscriber mode on SUBSCRIBE — it cannot run regular commands, so
   * never reuse your main client here.
   */
  sub: RedisSubLike;
}

type RedisSubStyle = 'ioredis' | 'node-redis';

/**
 * Production broker over Redis pub/sub.
 *
 * BYO two clients: `{ pub, sub }`. Supports both major client libraries:
 *
 * ```ts
 * // ioredis
 * import Redis from 'ioredis';
 * const broker = new RedisWsBroker({ pub: new Redis(), sub: new Redis() });
 *
 * // redis@4 (node-redis)
 * import { createClient } from 'redis';
 * const pub = createClient(); const sub = pub.duplicate();
 * await Promise.all([pub.connect(), sub.connect()]);
 * const broker = new RedisWsBroker({ pub, sub });
 * ```
 *
 * The API style is detected once at construction (pSubscribe vs psubscribe
 * marker methods, then the `on()` event surface) — no per-message probing.
 *
 * `close()` unsubscribes every channel this broker subscribed to and
 * detaches its listeners, but does NOT quit the injected clients — you
 * own their lifecycle.
 */
export class RedisWsBroker implements WsBroker {
  public readonly nodeId: string;

  private readonly _pub: RedisPubLike;
  private readonly _sub: RedisSubLike;
  private readonly _style: RedisSubStyle;
  private readonly _handlers = new Map<string, WsBrokerMessageHandler>();
  private _ioredisListener:
    | ((channel: string, message: string | Buffer) => void)
    | null = null;
  private _closed = false;

  constructor(clients: RedisWsBrokerClients, options: WsBrokerOptions = {}) {
    if (!clients || typeof clients.pub?.publish !== 'function') {
      throw new Error(
        '[axiomify/ws] RedisWsBroker requires a `pub` client with publish()',
      );
    }
    if (typeof clients.sub?.subscribe !== 'function') {
      throw new Error(
        '[axiomify/ws] RedisWsBroker requires a dedicated `sub` client with subscribe()',
      );
    }
    this._pub = clients.pub;
    this._sub = clients.sub;
    this.nodeId = options.nodeId ?? generateNodeId();
    this._style = this._detectStyle(clients.sub);
  }

  /**
   * Detect the subscriber API surface ONCE at construction — the same
   * "probe once, lock the shape" philosophy as rate-limit's RedisStore,
   * but via marker methods instead of a call probe (a call probe would
   * actually issue a SUBSCRIBE).
   */
  private _detectStyle(sub: RedisSubLike): RedisSubStyle {
    // node-redis v4 marker: camelCase pSubscribe.
    if (typeof sub.pSubscribe === 'function') return 'node-redis';
    // ioredis marker: lowercase psubscribe.
    if (typeof sub.psubscribe === 'function') return 'ioredis';
    // Fallback: ioredis subscribers are EventEmitters that deliver via
    // on('message'). If an event surface exists, prefer it; otherwise
    // assume the node-redis per-channel listener signature.
    if (typeof sub.on === 'function') return 'ioredis';
    return 'node-redis';
  }

  async publish(channel: string, payload: string | Buffer): Promise<void> {
    if (this._closed) {
      throw new Error('[axiomify/ws] RedisWsBroker is closed');
    }
    await this._pub.publish(channel, payload);
  }

  async subscribe(
    channel: string,
    handler: WsBrokerMessageHandler,
  ): Promise<void> {
    if (this._closed) {
      throw new Error('[axiomify/ws] RedisWsBroker is closed');
    }

    const already = this._handlers.has(channel);
    this._handlers.set(channel, handler);

    if (this._style === 'ioredis') {
      // Single shared 'message' listener dispatching by channel.
      if (!this._ioredisListener && typeof this._sub.on === 'function') {
        this._ioredisListener = (chan: string, message: string | Buffer) => {
          const h = this._handlers.get(chan);
          if (h) h(message, chan);
        };
        this._sub.on('message', this._ioredisListener);
      }
      if (!already) {
        await this._sub.subscribe(channel);
      }
      return;
    }

    // node-redis v4: per-channel listener passed to subscribe().
    // Re-subscribing the same channel just swaps the handler in our map;
    // the registered listener below always reads the latest one.
    if (!already) {
      await this._sub.subscribe(
        channel,
        (message: string | Buffer, chan: string) => {
          const h = this._handlers.get(chan ?? channel);
          if (h) h(message, chan ?? channel);
        },
      );
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this._handlers.has(channel)) return;
    this._handlers.delete(channel);
    await this._sub.unsubscribe(channel);
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    const channels = Array.from(this._handlers.keys());
    this._handlers.clear();

    // Best-effort unsubscribe — the caller may already have closed the
    // underlying connection during shutdown.
    for (const channel of channels) {
      try {
        await this._sub.unsubscribe(channel);
      } catch {
        // Connection already gone — nothing left to clean up on the server.
      }
    }

    if (this._ioredisListener) {
      const detach = this._sub.off ?? this._sub.removeListener;
      if (typeof detach === 'function') {
        detach.call(this._sub, 'message', this._ioredisListener);
      }
      this._ioredisListener = null;
    }
    // NOTE: injected clients are NOT quit — BYO lifecycle.
  }
}
