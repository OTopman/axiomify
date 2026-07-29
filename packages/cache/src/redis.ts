import type { CacheEntry, CacheStore } from './store';

/**
 * Minimal Redis client interface compatible with both `ioredis` and
 * `redis@4` (node-redis), mirroring `@axiomify/rate-limit`'s BYO-client
 * duck-typing — bring whichever client your app already uses.
 *
 *   ioredis:   `set(key, value, 'EX', ttl [, 'NX'])`, `setex(key, ttl, value)`
 *   redis@4:   `set(key, value, { EX, NX })`,          `setEx(key, ttl, value)`
 *
 * Style detection is deterministic when the client exposes its expiring-set
 * helper (`setex` → ioredis variadic, `setEx` → redis@4 options object).
 * Clients exposing neither are probed once on the first write: the options
 * object is tried first (redis@4 rejects loudly; ioredis forwards an
 * `[object Object]` argument the server rejects), then the variadic form.
 * The winning style is locked in — no per-call probing on the hot path.
 */
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(...args: any[]): Promise<unknown>;
  del(...keys: any[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  /** ioredis expiring-set helper — presence marks the variadic style. */
  setex?(key: string, seconds: number, value: string): Promise<unknown>;
  /** redis@4 expiring-set helper — presence marks the options-object style. */
  setEx?(key: string, seconds: number, value: string): Promise<unknown>;
}

export interface RedisCacheStoreOptions {
  /**
   * Namespace prepended to every key so `clear()` / `deleteByPrefix()` can
   * pattern-match without touching unrelated keys in a shared Redis.
   * Default: `'axiomify:cache:'`.
   */
  keyPrefix?: string;
}

/**
 * Suffix for SWR refresh-lock keys. Cache keys end in
 * `method NUL path NUL query [NUL name:value ...]` — every optional trailing
 * segment contains a `:`, and `refresh-lock` contains none, so the lock key
 * can never collide with a real entry key.
 */
const LOCK_SUFFIX = '\u0000refresh-lock';

/** Escape Redis glob metacharacters so a literal prefix matches literally. */
function escapeGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, (m) => `\\${m}`);
}

/**
 * Redis-backed {@link CacheStore}. Entries are stored as JSON strings with
 * `SET key value EX ttl`, so Redis expires them without any sweeper. The SWR
 * refresh lock uses `SET ... EX ttl NX` — atomic across every process sharing
 * the Redis, so exactly one instance in the whole fleet revalidates a stale
 * entry.
 */
export class RedisCacheStore implements CacheStore {
  private readonly prefix: string;
  private _setStyle: 'variadic' | 'object' | null = null;

  constructor(
    private readonly client: RedisCacheClient,
    options: RedisCacheStoreOptions = {},
  ) {
    this.prefix = options.keyPrefix ?? 'axiomify:cache:';
    if (typeof client.setex === 'function') {
      this._setStyle = 'variadic'; // ioredis
    } else if (typeof client.setEx === 'function') {
      this._setStyle = 'object'; // redis@4
    }
    if (typeof client.set !== 'function' || typeof client.get !== 'function') {
      throw new Error(
        '[axiomify/cache] RedisCacheStore requires a client implementing get() and set() (ioredis or redis@4).',
      );
    }
  }

  private async _setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
    nx: boolean,
  ): Promise<unknown> {
    const c = this.client;
    if (this._setStyle === 'object') {
      const opts: Record<string, unknown> = { EX: ttlSeconds };
      if (nx) opts.NX = true;
      return c.set(key, value, opts);
    }
    if (this._setStyle === 'variadic') {
      return nx
        ? c.set(key, value, 'EX', ttlSeconds, 'NX')
        : c.set(key, value, 'EX', ttlSeconds);
    }
    // Unknown client shape — probe once, then lock the style (mirrors
    // @axiomify/rate-limit's approach for eval/evalSha).
    try {
      const result = await c.set(
        key,
        value,
        nx ? { EX: ttlSeconds, NX: true } : { EX: ttlSeconds },
      );
      this._setStyle = 'object';
      return result;
    } catch {
      const result = await (nx
        ? c.set(key, value, 'EX', ttlSeconds, 'NX')
        : c.set(key, value, 'EX', ttlSeconds));
      this._setStyle = 'variadic';
      return result;
    }
  }

  public async get(key: string): Promise<CacheEntry | undefined> {
    const raw = await this.client.get(this.prefix + key);
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as CacheEntry;
    } catch {
      // Corrupted entry (partial write, foreign key) — drop it and miss.
      void this.delete(key).catch(() => {});
      return undefined;
    }
  }

  public async set(
    key: string,
    entry: CacheEntry,
    ttlSeconds: number,
  ): Promise<void> {
    await this._setWithTtl(
      this.prefix + key,
      JSON.stringify(entry),
      Math.max(1, Math.ceil(ttlSeconds)),
      false,
    );
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(this.prefix + key);
  }

  public async clear(): Promise<void> {
    await this.deleteByPrefix('');
  }

  /**
   * Deletes all entries under `prefix` via `KEYS pattern` + `DEL`. `KEYS` is
   * O(keyspace) and blocks Redis — fine for explicit invalidation calls, not
   * for hot-path use. The configured `keyPrefix` scopes the pattern so only
   * this cache's keys are examined.
   */
  public async deleteByPrefix(prefix: string): Promise<void> {
    const pattern = `${escapeGlob(this.prefix + prefix)}*`;
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  public async acquireRefreshLock(
    key: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this._setWithTtl(
      this.prefix + key + LOCK_SUFFIX,
      '1',
      Math.max(1, Math.ceil(ttlSeconds)),
      true,
    );
    // Both clients answer 'OK' when NX set succeeds, null when the key exists.
    return result === 'OK';
  }

  public async releaseRefreshLock(key: string): Promise<void> {
    await this.client.del(this.prefix + key + LOCK_SUFFIX);
  }
}
