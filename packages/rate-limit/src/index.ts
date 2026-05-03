import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';

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

  constructor(private readonly client: RedisClient) {}

  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const member = `${now}:${randomUUID()}`;
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
    // ioredis API: eval(script, numkeys, key, ...args)
    if (typeof (this.client as { eval?: unknown }).eval === 'function') {
      const c = this.client as { eval: (...a: unknown[]) => Promise<unknown> };
      // Try redis@4 object API first
      try {
        return await c.eval({ script: REDIS_SLIDING_WINDOW_SCRIPT, keys, arguments: args } as never);
      } catch {
        // Fall back to ioredis variadic API
        return await c.eval(REDIS_SLIDING_WINDOW_SCRIPT, keys.length, ...keys, ...args);
      }
    }
    throw new Error('[axiomify/rate-limit] RedisClient must implement eval()');
  }

  private async _evalSha(keys: string[], args: string[]): Promise<unknown> {
    const evalSha = (this.client as { evalsha?: unknown; evalSha?: unknown }).evalsha
      ?? (this.client as { evalSha?: unknown }).evalSha;

    if (typeof evalSha !== 'function') {
      // No evalsha method — signal the caller to use EVAL instead.
      throw new Error('NOSCRIPT');
    }

    // Try ioredis variadic style first: evalsha(sha, numkeys, ...keys, ...args)
    try {
      return await (evalSha as (...a: unknown[]) => Promise<unknown>).call(
        this.client, SCRIPT_SHA, keys.length, ...keys, ...args
      );
    } catch (firstErr: unknown) {
      const msg = String((firstErr as Error)?.message ?? firstErr);

      // NOSCRIPT means the script isn't cached — propagate so the caller
      // can fall back to EVAL. Do NOT try the second API style.
      if (msg.includes('NOSCRIPT')) throw firstErr;

      // Any other error might be an API mismatch — try redis@4 object style.
      try {
        return await (evalSha as (...a: unknown[]) => Promise<unknown>).call(
          this.client, SCRIPT_SHA, { keys, arguments: args }
        );
      } catch (secondErr: unknown) {
        const msg2 = String((secondErr as Error)?.message ?? secondErr);
        if (msg2.includes('NOSCRIPT')) throw secondErr;
        // Both styles failed — throw the original error.
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

// Emitted once per process to avoid log flooding.
let _emittedIpWarning = false;
let _emittedStoreWarning = false;

function createDefaultKeyGenerator(): (req: AxiomifyRequest) => string {
  return (req: AxiomifyRequest) => {
    if (!req.ip) {
      if (!_emittedIpWarning) {
        _emittedIpWarning = true;
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

function createStore(options: RateLimitOptions): RateLimitStore {
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
    !_emittedStoreWarning
  ) {
    _emittedStoreWarning = true;
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
  const store = createStore(options);
  const keyGenerator =
    options.keyGenerator ?? options.keyExtractor ?? createDefaultKeyGenerator();

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

    const { count, resetTime } = await store.increment(key, windowMs);
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
