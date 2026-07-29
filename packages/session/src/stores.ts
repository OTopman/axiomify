/**
 * Session storage backends.
 *
 * `@axiomify/session` follows the same BYO-store convention as
 * `@axiomify/auth` (TokenStore) and `@axiomify/rate-limit` (RateLimitStore):
 * a small async interface, an in-memory implementation for development and
 * single-process deployments, and a Redis implementation that duck-types
 * the client so both `ioredis` and `redis@4` work without a dependency.
 */

/**
 * The envelope persisted per session.
 *
 * `createdAt` (epoch ms) travels with the data so the plugin can enforce an
 * absolute timeout across processes — rolling/idle expiry alone would let a
 * session live forever as long as the client keeps visiting.
 */
export interface SessionRecord {
  data: Record<string, unknown>;
  createdAt: number;
}

/**
 * Pluggable session storage. All methods are async so network-backed
 * stores (Redis, database) drop in without API changes.
 *
 * - `get` returns `null`/`undefined` for missing or expired sessions.
 * - `set` must (re)write the record and reset the TTL.
 * - `touch` refreshes the TTL without rewriting data (idle-timeout slide).
 * - `destroy` removes the record; destroying a missing id is a no-op.
 */
export interface SessionStore {
  get(id: string): Promise<SessionRecord | null | undefined>;
  set(id: string, data: SessionRecord, ttlSeconds: number): Promise<void>;
  destroy(id: string): Promise<void>;
  touch(id: string, ttlSeconds: number): Promise<void>;
}

export interface MemorySessionStoreOptions {
  /**
   * Hard cap on concurrently stored sessions. Prevents an attacker who
   * forces new sessions (cookie-less scripted requests) from growing the
   * map without bound. When the cap is exceeded, expired entries are swept
   * first, then the oldest-written sessions are evicted. Default: 100 000.
   */
  maxSessions?: number;
  /** Background sweep interval for expired entries (ms). Default: 60 000. */
  sweepIntervalMs?: number;
}

/**
 * In-memory session store: Map + TTL.
 *
 * Expiry is enforced two ways:
 *  - lazily on `get` (an expired entry is deleted and reported as a miss),
 *  - eagerly by an `unref`'d sweep timer so abandoned sessions don't pile
 *    up between reads. The timer never keeps the process alive.
 *
 * Records are `structuredClone`d on both write and read so callers never
 * alias live store state — the same isolation a network store (Redis)
 * provides via serialisation, and a prerequisite for the session plugin's
 * dirty tracking (an aliased record would mutate the store without a save).
 * Session data must therefore be structured-cloneable (it must be
 * JSON-serialisable anyway for Redis parity).
 *
 * Per-process only — like `MemoryTokenStore` in @axiomify/auth, use a
 * distributed store (RedisSessionStore) for clustered/multi-instance
 * deployments.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<
    string,
    { record: SessionRecord; expiresAt: number }
  >();
  private readonly timer: NodeJS.Timeout;
  private readonly maxSessions: number;

  constructor(options: MemorySessionStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? 100_000;
    this.timer = setInterval(
      () => this.sweep(),
      options.sweepIntervalMs ?? 60_000,
    );
    this.timer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (entry.expiresAt <= now) this.sessions.delete(id);
    }
  }

  public async get(id: string): Promise<SessionRecord | null> {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return structuredClone(entry.record);
  }

  public async set(
    id: string,
    record: SessionRecord,
    ttlSeconds: number,
  ): Promise<void> {
    // Delete-then-set refreshes Map insertion order, so the eviction loop
    // below always removes the *least recently written* session.
    this.sessions.delete(id);
    this.sessions.set(id, {
      record: structuredClone(record),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    if (this.sessions.size > this.maxSessions) {
      this.sweep();
      while (this.sessions.size > this.maxSessions) {
        const oldest = this.sessions.keys().next().value;
        if (oldest === undefined) break;
        this.sessions.delete(oldest);
      }
    }
  }

  public async destroy(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  public async touch(id: string, ttlSeconds: number): Promise<void> {
    const entry = this.sessions.get(id);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  /** Number of stored sessions (including not-yet-swept expired entries). */
  public get size(): number {
    return this.sessions.size;
  }

  /** Stop the background sweep timer (tests / graceful shutdown). */
  public close(): void {
    clearInterval(this.timer);
  }
}

/**
 * Minimal Redis client surface compatible with both `ioredis` and `redis@4`
 * — same duck-typing approach as RedisStore in @axiomify/rate-limit.
 *
 * The only call whose shape differs between the two libraries is `set` with
 * a TTL:
 *   - ioredis:  `client.set(key, value, 'EX', ttl)`   (variadic)
 *   - redis@4:  `client.set(key, value, { EX: ttl })` (options object)
 *
 * `get`, `del` and `expire` share the same signature in both.
 */
export interface SessionRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  expire(key: string, ttlSeconds: number): Promise<unknown>;
  /** ioredis expiring-set helper — presence marks the variadic style. */
  setex?(key: string, seconds: number, value: string): Promise<unknown>;
  /** redis@4 expiring-set helper — presence marks the options-object style. */
  setEx?(key: string, seconds: number, value: string): Promise<unknown>;
}

export interface RedisSessionStoreOptions {
  /** Key prefix for all session keys. Default: `axiomify:sess:`. */
  prefix?: string;
}

/**
 * Redis-backed session store. Bring your own connected client (ioredis or
 * redis@4) — this package takes zero dependencies.
 *
 * Records are stored as JSON under `<prefix><sessionId>` with `SET ... EX`
 * for atomic write+TTL; `touch` maps to `EXPIRE`. The `set` argument shape
 * is resolved deterministically when the client exposes its expiring-set
 * helper (`setex` → ioredis variadic, `setEx` → redis@4 options object —
 * same marker-based detection as `@axiomify/cache`'s RedisCacheStore).
 * Clients exposing neither are probed once on first use and the winning
 * style cached (probing per call would pay a throw/catch on every request —
 * see the rate-limit RedisStore rationale).
 */
export class RedisSessionStore implements SessionStore {
  private _setStyle: 'variadic' | 'object' | null = null;
  private readonly prefix: string;

  constructor(
    private readonly client: SessionRedisClient,
    options: RedisSessionStoreOptions = {},
  ) {
    if (
      !client ||
      typeof client.get !== 'function' ||
      typeof client.set !== 'function' ||
      typeof client.del !== 'function' ||
      typeof client.expire !== 'function'
    ) {
      throw new Error(
        '[axiomify/session] RedisSessionStore requires a client implementing ' +
          'get/set/del/expire (ioredis and redis@4 both qualify).',
      );
    }
    if (typeof client.setex === 'function') {
      this._setStyle = 'variadic'; // ioredis
    } else if (typeof client.setEx === 'function') {
      this._setStyle = 'object'; // redis@4
    }
    this.prefix = options.prefix ?? 'axiomify:sess:';
  }

  private key(id: string): string {
    return this.prefix + id;
  }

  public async get(id: string): Promise<SessionRecord | null> {
    const raw = await this.client.get(this.key(id));
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as SessionRecord;
    } catch {
      // Corrupt/foreign payload under our key — treat as a miss so the
      // request gets a fresh session instead of a 500.
      return null;
    }
  }

  public async set(
    id: string,
    record: SessionRecord,
    ttlSeconds: number,
  ): Promise<void> {
    const key = this.key(id);
    const json = JSON.stringify(record);
    const ttl = Math.max(1, Math.ceil(ttlSeconds));

    // Fast paths: argument shape already known — no try/catch, no probe.
    if (this._setStyle === 'variadic') {
      await this.client.set(key, json, 'EX', ttl);
      return;
    }
    if (this._setStyle === 'object') {
      await this.client.set(key, json, { EX: ttl });
      return;
    }

    // First call: probe ioredis' variadic shape, fall back to redis@4's
    // options object, then lock the style for all subsequent calls.
    try {
      await this.client.set(key, json, 'EX', ttl);
      this._setStyle = 'variadic';
    } catch {
      await this.client.set(key, json, { EX: ttl });
      this._setStyle = 'object';
    }
  }

  public async destroy(id: string): Promise<void> {
    await this.client.del(this.key(id));
  }

  public async touch(id: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(this.key(id), Math.max(1, Math.ceil(ttlSeconds)));
  }
}
