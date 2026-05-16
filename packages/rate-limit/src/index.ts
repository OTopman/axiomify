import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import { createHash } from 'crypto';

// Counter-based ZADD member suffix. Cheaper than randomUUID() and strictly
// more unique under high load: two requests at the same millisecond in the
// same process get different counters, whereas UUID has a (negligible but
// real) collision probability. PID-prefixed for multi-process safety.
let _rlCounter = 0;
const _rlPid = process.pid.toString(36);
const nextMember = (now: number) => `${now}:${_rlPid}:${(++_rlCounter).toString(36)}`;

const REDIS_SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local member = ARGV[3]
  local windowStart = now - window
  redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  local count = redis.call('ZCARD', key)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetTime = oldest[2] and math.ceil((tonumber(oldest[2]) + window) / 1000) or math.ceil((now + window) / 1000)
  return {count, resetTime}
`;

// SHA1 of the script — computed once at module load, used for EVALSHA caching.
const SCRIPT_SHA = createHash('sha1').update(REDIS_SLIDING_WINDOW_SCRIPT).digest('hex');

export interface RateLimitStore {
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }>;
}

/**
 * Minimal Redis client interface compatible with both `ioredis` and `redis@4`.
 *
 * ioredis:  `client.eval(script, numkeys, ...args)` and `client.evalsha(sha, numkeys, ...args)`
 * redis@4:  `client.eval({ script, keys, arguments })` and `client.evalSha(sha, { keys, arguments })`
 *
 * RedisStore auto-detects which API is available and uses EVALSHA when the
 * script is already cached in Redis (avoids resending the full Lua script on
 * every request). Falls back to EVAL on NOSCRIPT errors.
 */
export interface RedisClient {
  // ioredis-style (variadic)
  eval?(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
  evalsha?(sha: string, numkeys: number, ...args: string[]): Promise<unknown>;
  // redis@4-style (object)
  eval?(opts: { script: string; keys: string[]; arguments: string[] }): Promise<unknown>;
  evalSha?(sha: string, opts: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export class RedisStore {
  /** Whether the Lua script is already cached in Redis (EVALSHA usable). */
  private _scriptLoaded = false;
  // Cache the client's argument-shape AFTER the first successful call.
  // Probing every request (try object-form → catch → variadic) is a real
  // hot-path cost: the throw-catch cycle in V8 deopts the surrounding
  // function and the per-request method-shape probe was measurable in
  // earlier profiling. `null` = unknown (probe), `'object'` = redis@4
  // (`{ script, keys, arguments }`), `'variadic'` = ioredis
  // (`script, numkeys, ...keys, ...args`).
  private _evalStyle: 'object' | 'variadic' | null = null;
  private _evalShaStyle: 'object' | 'variadic' | null = null;

  constructor(private readonly client: RedisClient) {}

  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const member = nextMember(now);
    const keys = [key];
    const args = [now.toString(), windowMs.toString(), member];

    let result: unknown;

    // Try EVALSHA first if the script might be cached; fall through to EVAL on
    // NOSCRIPT error. This eliminates full script upload on every call.
    if (this._scriptLoaded) {
      try {
        result = await this._evalSha(keys, args);
      } catch (err: unknown) {
        const msg = String((err as Error).message ?? '');
        if (msg.includes('NOSCRIPT')) {
          this._scriptLoaded = false;
          result = await this._eval(keys, args);
          this._scriptLoaded = true;
        } else {
          throw err;
        }
      }
    } else {
      result = await this._eval(keys, args);
      this._scriptLoaded = true;
    }

    const [count, resetTime] = result as [number, number];
    return { count, resetTime };
  }

  private async _eval(keys: string[], args: string[]): Promise<unknown> {
    if (typeof (this.client as { eval?: unknown }).eval !== 'function') {
      throw new Error('[axiomify/rate-limit] RedisClient must implement eval()');
    }
    const c = this.client as { eval: (...a: unknown[]) => Promise<unknown> };

    // Fast path: shape already known. No try/catch, no probe.
    if (this._evalStyle === 'object') {
      return c.eval({ script: REDIS_SLIDING_WINDOW_SCRIPT, keys, arguments: args } as never);
    }
    if (this._evalStyle === 'variadic') {
      return c.eval(REDIS_SLIDING_WINDOW_SCRIPT, keys.length, ...keys, ...args);
    }

    // First call: probe both shapes ONCE and lock the result. Subsequent
    // calls go through the fast path above with zero overhead.
    try {
      const result = await c.eval({ script: REDIS_SLIDING_WINDOW_SCRIPT, keys, arguments: args } as never);
      this._evalStyle = 'object';
      return result;
    } catch {
      const result = await c.eval(REDIS_SLIDING_WINDOW_SCRIPT, keys.length, ...keys, ...args);
      this._evalStyle = 'variadic';
      return result;
    }
  }

  private async _evalSha(keys: string[], args: string[]): Promise<unknown> {
    const evalSha = (this.client as { evalsha?: unknown; evalSha?: unknown }).evalsha
      ?? (this.client as { evalSha?: unknown }).evalSha;

    if (typeof evalSha !== 'function') {
      // No evalsha method — signal the caller to use EVAL instead.
      throw new Error('NOSCRIPT');
    }
    const fn = (evalSha as (...a: unknown[]) => Promise<unknown>).bind(this.client);

    // Fast path: shape already known.
    if (this._evalShaStyle === 'variadic') {
      return fn(SCRIPT_SHA, keys.length, ...keys, ...args);
    }
    if (this._evalShaStyle === 'object') {
      return fn(SCRIPT_SHA, { keys, arguments: args });
    }

    // First call: try ioredis variadic style first (more common in production
    // deployments). NOSCRIPT bubbles up to the caller — the EVAL path will
    // upload the script and the next EVALSHA will succeed.
    try {
      const result = await fn(SCRIPT_SHA, keys.length, ...keys, ...args);
      this._evalShaStyle = 'variadic';
      return result;
    } catch (firstErr: unknown) {
      const msg = String((firstErr as Error)?.message ?? firstErr);
      if (msg.includes('NOSCRIPT')) throw firstErr;

      // Variadic failed for a non-NOSCRIPT reason (API mismatch). Try the
      // redis@4 object shape. If THAT also returns NOSCRIPT, propagate so
      // the caller can EVAL.
      try {
        const result = await fn(SCRIPT_SHA, { keys, arguments: args });
        this._evalShaStyle = 'object';
        return result;
      } catch (secondErr: unknown) {
        const msg2 = String((secondErr as Error)?.message ?? secondErr);
        if (msg2.includes('NOSCRIPT')) throw secondErr;
        // Both styles failed — surface the original error (more diagnostic).
        throw firstErr;
      }
    }
  }
}

export interface MemoryStoreOptions {
  /**
   * Hard cap for unique keys kept in memory. Prevents attacker-controlled
   * key cardinality from growing this map without bound.
   */
  maxKeys?: number;
}

export class MemoryStore implements RateLimitStore {
  private hits = new Map<
    string,
    { timestamps: number[]; start: number; windowMs: number }
  >();
  private timer: NodeJS.Timeout;
  private readonly maxKeys: number;

  constructor(options: MemoryStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? 50_000;
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref();
  }

  private prune() {
    const now = Date.now();
    for (const [key, data] of this.hits.entries()) {
      const windowStart = now - data.windowMs;
      while (
        data.start < data.timestamps.length &&
        data.timestamps[data.start] <= windowStart
      ) {
        data.start++;
      }
      if (data.start >= data.timestamps.length) {
        this.hits.delete(key);
        continue;
      }
      if (data.start > 1024 && data.start * 2 > data.timestamps.length) {
        data.timestamps = data.timestamps.slice(data.start);
        data.start = 0;
      }
    }
  }

  public async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const data = this.hits.get(key) ?? { timestamps: [], start: 0, windowMs };
    while (
      data.start < data.timestamps.length &&
      data.timestamps[data.start] <= windowStart
    ) {
      data.start++;
    }
    data.timestamps.push(now);
    if (data.start > 1024 && data.start * 2 > data.timestamps.length) {
      data.timestamps = data.timestamps.slice(data.start);
      data.start = 0;
    }
    this.hits.set(key, data);

    if (this.hits.size > this.maxKeys) {
      this.prune();
      while (this.hits.size > this.maxKeys) {
        const oldestKey = this.hits.keys().next().value;
        if (oldestKey === undefined) break;
        this.hits.delete(oldestKey);
      }
    }

    const count = data.timestamps.length - data.start;
    const oldest = data.timestamps[data.start] ?? now;
    const resetTime = Math.ceil((oldest + windowMs) / 1000);

    return { count, resetTime };
  }

  public close(): void {
    clearInterval(this.timer);
  }
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  maxRequests?: number;
  store?: RateLimitStore;
  keyGenerator?: (req: AxiomifyRequest) => string;
  keyExtractor?: (req: AxiomifyRequest) => string;
  skip?: (req: AxiomifyRequest) => boolean;
  /**
   * In production, using MemoryStore is unsafe for multi-process/multi-instance
   * deployments. Set this only for explicitly single-process deployments.
   */
  allowMemoryStoreInProduction?: boolean;
  memoryStoreMaxKeys?: number;
}

/**
 * Per-plugin warning state. Module-level flags would suppress legitimate
 * warnings the second time the plugin is constructed in the same process
 * — bad ergonomics for tests, multi-tenant deployments, and any setup
 * where two `createRateLimitPlugin()` calls exist in one Node.js process.
 *
 * Each call to `buildLimiter` creates a fresh WarningCtx so warnings fire
 * once per plugin instance, not once per process.
 */
interface WarningCtx {
  ipEmitted: boolean;
  storeEmitted: boolean;
}

function newWarningCtx(): WarningCtx {
  return { ipEmitted: false, storeEmitted: false };
}

function createDefaultKeyGenerator(
  warnings: WarningCtx,
): (req: AxiomifyRequest) => string {
  return (req: AxiomifyRequest) => {
    if (!req.ip) {
      if (!warnings.ipEmitted) {
        warnings.ipEmitted = true;
        console.warn(
          '[axiomify/rate-limit] req.ip is falsy on an incoming request. ' +
            'These requests will share the "unknown" rate-limit bucket, which ' +
            'means a single client can exhaust the limit for all IP-less traffic. ' +
            'Ensure your adapter populates req.ip correctly (check proxy/trust settings).',
        );
      }
      return 'unknown';
    }
    return req.ip;
  };
}

function createStore(options: RateLimitOptions, warnings: WarningCtx): RateLimitStore {
  const provided = options.store;
  if (provided) return provided;

  if (
    process.env.NODE_ENV === 'production' &&
    !options.allowMemoryStoreInProduction
  ) {
    throw new Error(
      '[axiomify/rate-limit] Refusing to use in-memory MemoryStore in production. ' +
        'Provide a distributed store such as RedisStore, or set ' +
        '`allowMemoryStoreInProduction: true` only for a known single-process deployment.',
    );
  }

  if (
    process.env.NODE_ENV === 'production' &&
    options.allowMemoryStoreInProduction &&
    !warnings.storeEmitted
  ) {
    warnings.storeEmitted = true;
    console.warn(
      '[axiomify/rate-limit] Using in-memory MemoryStore in production. ' +
        'MemoryStore is per-process: each Node.js worker or container instance ' +
        'maintains its own counter, so the effective rate limit is ' +
        'max × numberOfProcesses. Provide a RedisStore for multi-process or ' +
        'multi-instance deployments.',
    );
  }

  return new MemoryStore({ maxKeys: options.memoryStoreMaxKeys });
}

function buildLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? options.maxRequests ?? 100;
  // Per-plugin warning state — see WarningCtx docs above.
  const warnings = newWarningCtx();
  const store = createStore(options, warnings);
  const keyGenerator =
    options.keyGenerator ?? options.keyExtractor ?? createDefaultKeyGenerator(warnings);

  return async (req: AxiomifyRequest, res: AxiomifyResponse) => {
    // Wrap skip() in try/catch — a throwing skip silently bypasses rate limiting.
    try {
      if (options.skip?.(req)) return;
    } catch {
      // Skip function threw — treat as "do not skip" (fail-closed).
    }

    // Wrap keyGenerator in try/catch — a throwing keyGenerator (e.g. accessing
    // req.body.email when body is undefined) would propagate as a 500 and bypass
    // rate limiting entirely. Fail-closed: fall back to IP address.
    let key: string;
    try {
      key = keyGenerator(req);
    } catch {
      key = req.ip ?? 'unknown';
    }

    let count: number;
    let resetTime: number;
    try {
      const res = await store.increment(key, windowMs);
      count = res.count;
      resetTime = res.resetTime;
    } catch (err) {
      // Store unavailable — fail closed with 503, not 429
      res.status(503).send(null, 'Rate limit service unavailable');
      return;
    }
    const remaining = Math.max(0, max - count);

    res.header('X-RateLimit-Limit', String(max));
    res.header('X-RateLimit-Remaining', String(remaining));
    res.header('X-RateLimit-Reset', String(resetTime));

    if (count > max) {
      res.header('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).send(null, 'Too Many Requests');
      return;
    }
  };
}

export function createRateLimitPlugin(options: RateLimitOptions = {}) {
  return buildLimiter(options);
}

export function useRateLimit(
  app: Axiomify,
  options: RateLimitOptions = {},
): void {
  const limiter = buildLimiter(options);
  app.addHook('onPreHandler', async (req, res) => {
    await limiter(req, res);
  });
}
