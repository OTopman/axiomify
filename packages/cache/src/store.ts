/**
 * A single cached response variant.
 *
 * The payload is the **final serialized body** — for `res.send()` responses it
 * is the JSON produced by the app serializer, for `res.sendRaw()` it is the
 * raw string. Replaying a hit therefore bypasses the serializer entirely and
 * emits via `res.sendRaw(entry.payload, entry.contentType)`.
 */
export interface CacheEntry {
  /** Final response body, exactly as sent to the client. */
  payload: string;
  /** HTTP status the response was sent with. */
  statusCode: number;
  /** Content-Type the response was sent with. */
  contentType: string;
  /** ETag computed (or set by the handler) for this payload, if any. */
  etag?: string;
  /** Epoch-ms timestamp of when the entry was written. */
  storedAt: number;
  /** Freshness lifetime in milliseconds. Within this window: X-Cache: HIT. */
  ttlMs: number;
  /**
   * Stale-while-revalidate grace in milliseconds. Between `ttlMs` and
   * `ttlMs + swrMs` the entry may still be served (X-Cache: STALE) while one
   * request refreshes it.
   */
  swrMs: number;
  /**
   * Per-route vary constraint (from `cached({ varyHeaders })`): lowercased
   * request-header name → the value the entry was stored under. Checked as a
   * secondary key on lookup — a mismatch is a miss. One variant per key.
   */
  vary?: Record<string, string>;
}

/**
 * Pluggable cache backend. All methods are async so distributed backends
 * (Redis, Memcached, DynamoDB, …) fit the same interface as the in-process
 * store.
 *
 * `set` receives the ttl in **seconds** — it is always `ttl + swr` so the
 * backend keeps stale-but-servable entries alive through the whole
 * revalidation window. Freshness within an entry is judged from
 * `storedAt`/`ttlMs`/`swrMs`, never from backend expiry.
 */
export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Optional: delete every entry whose key starts with `prefix`. Required for
   * `invalidatePath()`. Both first-party stores implement it.
   */
  deleteByPrefix?(prefix: string): Promise<void>;
  /**
   * Optional: atomically claim the right to refresh a stale entry. Returns
   * `true` for exactly one caller per `ttlSeconds` window (per store — a
   * shared Redis store coordinates across processes). When absent, the plugin
   * falls back to a per-process in-memory flag.
   */
  acquireRefreshLock?(key: string, ttlSeconds: number): Promise<boolean>;
  /** Optional: release a refresh claim early (called after the fresh write). */
  releaseRefreshLock?(key: string): Promise<void>;
}

export interface MemoryCacheStoreOptions {
  /**
   * Hard cap on the number of entries. Least-recently-used entries are
   * evicted first. Bounds attacker-controlled key cardinality
   * (query-string permutations, vary-header values). Default: 1000.
   */
  maxEntries?: number;
  /**
   * Approximate cap on total payload bytes held in memory (payload byte
   * length + key length + fixed per-entry overhead). LRU-evicts down to the
   * cap; an entry larger than the cap by itself is never stored.
   * Default: 32 MiB.
   */
  maxBytes?: number;
  /** Interval of the background expiry sweep in ms. Default: 60 000. */
  sweepIntervalMs?: number;
}

interface MemRecord {
  entry: CacheEntry;
  expiresAt: number;
  bytes: number;
}

/** Rough per-entry bookkeeping overhead (Map slot, record object, numbers). */
const ENTRY_OVERHEAD_BYTES = 200;

/**
 * In-process LRU cache store.
 *
 *   - **LRU**: backed by a `Map`; `get()` re-inserts the record so Map
 *     iteration order doubles as recency order. Eviction pops the first key.
 *   - **Expiry**: lazy on `get()` (an expired record is deleted and reported
 *     as a miss) plus an unref'd background sweep so long-idle processes
 *     don't pin dead payloads. The sweep timer never keeps the process alive.
 *   - **Bounds**: `maxEntries` and `maxBytes` are both enforced on every
 *     `set()`.
 *
 * Per-process only — for multi-instance deployments use {@link RedisCacheStore}
 * from this package so all instances share entries and the SWR refresh lock.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly records = new Map<string, MemRecord>();
  private readonly locks = new Map<string, number>();
  private _bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly timer: NodeJS.Timeout;

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    this.timer = setInterval(
      () => this.sweep(),
      options.sweepIntervalMs ?? 60_000,
    );
    this.timer.unref?.();
  }

  /** Current entry count (diagnostics/tests). */
  public get size(): number {
    return this.records.size;
  }

  /** Current tracked byte total (diagnostics/tests). */
  public get byteSize(): number {
    return this._bytes;
  }

  public async get(key: string): Promise<CacheEntry | undefined> {
    const rec = this.records.get(key);
    if (!rec) return undefined;
    if (rec.expiresAt <= Date.now()) {
      this.records.delete(key);
      this._bytes -= rec.bytes;
      return undefined;
    }
    // LRU touch: re-insert so Map order reflects recency.
    this.records.delete(key);
    this.records.set(key, rec);
    return rec.entry;
  }

  public async set(
    key: string,
    entry: CacheEntry,
    ttlSeconds: number,
  ): Promise<void> {
    const bytes =
      Buffer.byteLength(entry.payload) + key.length + ENTRY_OVERHEAD_BYTES;
    // A payload that alone exceeds the byte budget would evict the whole
    // cache and still not fit — refuse it outright.
    if (bytes > this.maxBytes) return;
    const prev = this.records.get(key);
    if (prev) {
      this.records.delete(key);
      this._bytes -= prev.bytes;
    }
    this.records.set(key, {
      entry,
      expiresAt: Date.now() + ttlSeconds * 1000,
      bytes,
    });
    this._bytes += bytes;
    this.evict();
  }

  private evict(): void {
    while (this.records.size > this.maxEntries || this._bytes > this.maxBytes) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      const rec = this.records.get(oldest)!;
      this.records.delete(oldest);
      this._bytes -= rec.bytes;
    }
  }

  public async delete(key: string): Promise<void> {
    const rec = this.records.get(key);
    if (!rec) return;
    this.records.delete(key);
    this._bytes -= rec.bytes;
  }

  public async clear(): Promise<void> {
    this.records.clear();
    this.locks.clear();
    this._bytes = 0;
  }

  public async deleteByPrefix(prefix: string): Promise<void> {
    for (const [key, rec] of this.records) {
      if (key.startsWith(prefix)) {
        this.records.delete(key);
        this._bytes -= rec.bytes;
      }
    }
  }

  public async acquireRefreshLock(
    key: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const now = Date.now();
    const heldUntil = this.locks.get(key);
    if (heldUntil !== undefined && heldUntil > now) return false;
    this.locks.set(key, now + ttlSeconds * 1000);
    return true;
  }

  public async releaseRefreshLock(key: string): Promise<void> {
    this.locks.delete(key);
  }

  /** Remove expired records and refresh locks. Runs on the unref'd timer. */
  public sweep(): void {
    const now = Date.now();
    for (const [key, rec] of this.records) {
      if (rec.expiresAt <= now) {
        this.records.delete(key);
        this._bytes -= rec.bytes;
      }
    }
    for (const [key, until] of this.locks) {
      if (until <= now) this.locks.delete(key);
    }
  }

  /** Stop the background sweep timer (tests / graceful shutdown). */
  public close(): void {
    clearInterval(this.timer);
  }
}
