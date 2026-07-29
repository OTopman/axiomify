/**
 * mini-redis — a tiny RESP2 client for the opt-in Redis INTEGRATION tests.
 *
 * The repo has a hard "no Redis dependency" rule: every store/broker
 * duck-types a BYO client (ioredis or redis@4). To exercise those stores
 * against a REAL Redis without adding a runtime (or dev) dependency, this
 * helper speaks just enough RESP2 over a raw `node:net` socket:
 *
 *   - RESP command encoding (array of bulk strings) and reply parsing
 *     (simple strings, errors, integers, bulk strings, arrays, nulls).
 *   - A FIFO promise queue correlating requests with replies (Redis answers
 *     strictly in order on a single connection).
 *   - Subscriber mode: after SUBSCRIBE the connection receives push arrays
 *     `['message', channel, payload]`, dispatched as ioredis-style
 *     `on('message', (channel, payload) => …)` events.
 *
 * The public surface is deliberately the ioredis calling convention, because
 * every store under test detects/probes that style first:
 *   - RedisCacheStore:   `setex` marker → locks the variadic `set(k, v, 'EX', ttl[, 'NX'])` style.
 *   - RedisSessionStore: probes `set(k, v, 'EX', ttl)` first → variadic wins.
 *   - RedisWsBroker:     no `psubscribe`/`pSubscribe` markers, but `on()` exists → ioredis style.
 *
 * TEST HELPER ONLY: correctness over performance. No reconnects, no
 * pipelining niceties, no pub/sub pattern-subscribe, no RESP3.
 */
import { EventEmitter } from 'node:events';
import * as net from 'node:net';

type RespReply = string | number | null | Error | RespReply[];

/** Encode a command as a RESP array of bulk strings. */
function encodeCommand(args: Array<string | number>): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const s = String(arg);
    parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

/**
 * Try to parse ONE complete RESP reply starting at `pos`.
 * Returns `[value, nextPos]`, or `null` when the buffer is incomplete.
 */
function parseReply(buf: Buffer, pos: number): [RespReply, number] | null {
  const lineEnd = buf.indexOf('\r\n', pos);
  if (pos >= buf.length || lineEnd === -1) return null;
  const type = String.fromCharCode(buf[pos]);
  const line = buf.toString('utf8', pos + 1, lineEnd);
  const next = lineEnd + 2;

  switch (type) {
    case '+': // simple string
      return [line, next];
    case '-': // error reply — surfaced as an Error so callers can reject
      return [new Error(`[mini-redis] server error: ${line}`), next];
    case ':': // integer
      return [Number(line), next];
    case '$': {
      // bulk string ($-1 = null)
      const len = Number(line);
      if (len === -1) return [null, next];
      if (buf.length < next + len + 2) return null; // body not fully buffered
      return [buf.toString('utf8', next, next + len), next + len + 2];
    }
    case '*': {
      // array (*-1 = null)
      const count = Number(line);
      if (count === -1) return [null, next];
      const items: RespReply[] = [];
      let cursor = next;
      for (let i = 0; i < count; i++) {
        const parsed = parseReply(buf, cursor);
        if (parsed === null) return null;
        items.push(parsed[0]);
        cursor = parsed[1];
      }
      return [items, cursor];
    }
    default:
      throw new Error(
        `[mini-redis] unsupported RESP type byte ${JSON.stringify(type)} — is this really a Redis server?`,
      );
  }
}

interface Pending {
  resolve: (value: RespReply) => void;
  reject: (err: Error) => void;
}

/**
 * One Redis connection. Emits `'message' (channel, payload)` when used as a
 * subscriber (ioredis convention). Create a DEDICATED instance for
 * subscribing — Redis forbids regular commands on a subscribed connection.
 */
export class MiniRedis extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pending: Pending[] = [];
  private subscriberMode = false;
  private closed = false;

  private constructor(private readonly socket: net.Socket) {
    super();
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => this.failAll(err));
    socket.on('close', () =>
      this.failAll(new Error('[mini-redis] connection closed')),
    );
  }

  /**
   * Connect using a redis:// URL (default: `process.env.REDIS_URL`).
   * A URL path selects a logical database, e.g. redis://localhost:6379/15.
   */
  static async connect(url = process.env.REDIS_URL): Promise<MiniRedis> {
    if (!url) throw new Error('[mini-redis] REDIS_URL is not set');
    const parsed = new URL(url);
    const client = await new Promise<MiniRedis>((resolve, reject) => {
      const socket = net.connect(
        Number(parsed.port || 6379),
        parsed.hostname || '127.0.0.1',
      );
      const onError = (err: Error) => reject(err);
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.off('error', onError);
        resolve(new MiniRedis(socket));
      });
    });
    if (parsed.password) await client.command('AUTH', parsed.password);
    const db = parsed.pathname.replace(/^\//, '');
    if (db) await client.command('SELECT', db);
    return client;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let pos = 0;
    for (;;) {
      const parsed = parseReply(this.buffer, pos);
      if (parsed === null) break;
      pos = parsed[1];
      this.dispatch(parsed[0]);
    }
    if (pos > 0) this.buffer = this.buffer.subarray(pos);
  }

  private dispatch(reply: RespReply): void {
    // Subscriber-mode push messages are NOT replies to queued commands.
    // (SUBSCRIBE/UNSUBSCRIBE confirmations also arrive as arrays and DO
    // answer their command, so only 'message' bypasses the queue.)
    if (this.subscriberMode && Array.isArray(reply) && reply[0] === 'message') {
      this.emit('message', String(reply[1]), String(reply[2]));
      return;
    }
    const waiter = this.pending.shift();
    if (!waiter) return; // reply after teardown — drop
    if (reply instanceof Error) waiter.reject(reply);
    else waiter.resolve(reply);
  }

  private failAll(err: Error): void {
    while (this.pending.length > 0) {
      // Expected while quitting; only pre-close commands still queued matter.
      if (this.closed) this.pending.shift()!.resolve(null);
      else this.pending.shift()!.reject(err);
    }
  }

  /** Send a raw command and await its reply. */
  command(...args: Array<string | number>): Promise<RespReply> {
    if (this.closed) {
      return Promise.reject(new Error('[mini-redis] client already quit'));
    }
    return new Promise<RespReply>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(args));
    });
  }

  // ── ioredis-like key/value surface (what the stores under test call) ──────

  get(key: string): Promise<string | null> {
    return this.command('GET', key) as Promise<string | null>;
  }

  /**
   * Variadic SET, ioredis-style: `set(key, value, 'EX', ttl [, 'NX'])`.
   * Returns 'OK' on success and `null` when NX prevented the write — exactly
   * what RedisCacheStore's refresh lock inspects.
   */
  set(...args: Array<string | number>): Promise<RespReply> {
    if (args.some((a) => typeof a === 'object' && a !== null)) {
      throw new Error(
        '[mini-redis] options-object set() (redis@4 style) is not implemented — this helper presents the ioredis surface',
      );
    }
    return this.command('SET', ...args);
  }

  /** ioredis marker method — its PRESENCE locks stores into variadic style. */
  setex(key: string, seconds: number, value: string): Promise<RespReply> {
    return this.command('SETEX', key, seconds, value);
  }

  /** DEL accepts keys variadically or as a single array (both ioredis forms). */
  del(...keys: Array<string | string[]>): Promise<number> {
    return this.command('DEL', ...keys.flat()) as Promise<number>;
  }

  keys(pattern: string): Promise<string[]> {
    return this.command('KEYS', pattern) as Promise<string[]>;
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.command('EXPIRE', key, seconds) as Promise<number>;
  }

  ttl(key: string): Promise<number> {
    return this.command('TTL', key) as Promise<number>;
  }

  exists(...keys: string[]): Promise<number> {
    return this.command('EXISTS', ...keys) as Promise<number>;
  }

  /** FLUSHDB — only ever point this at a dedicated logical database. */
  flushdb(): Promise<RespReply> {
    return this.command('FLUSHDB');
  }

  // ── pub/sub surface (RedisWsBroker's RedisPubLike / RedisSubLike) ─────────

  publish(channel: string, message: string | Buffer): Promise<number> {
    return this.command('PUBLISH', channel, String(message)) as Promise<number>;
  }

  /** Puts this connection into subscriber mode; messages arrive via on('message'). */
  async subscribe(channel: string): Promise<void> {
    this.subscriberMode = true;
    await this.command('SUBSCRIBE', channel); // resolves on ['subscribe', ch, n]
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.command('UNSUBSCRIBE', channel);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Graceful teardown. Safe to call in any mode; idempotent. */
  async quit(): Promise<void> {
    if (this.closed) return;
    const goodbye = this.command('QUIT'); // QUIT is allowed in subscriber mode
    this.closed = true; // reject anything issued after this point
    try {
      await goodbye;
    } catch {
      // Connection may already be gone — destroy below either way.
    }
    this.socket.destroy();
  }
}

/** Convenience alias mirroring `createClient()`-style factories. */
export const connectMiniRedis = MiniRedis.connect;
