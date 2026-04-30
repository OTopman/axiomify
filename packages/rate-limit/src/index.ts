import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
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

export interface RateLimitStore {
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }>;
}

export interface RedisClient {
  eval(
    script: string,
    numkeys: number,
    ...args: string[]
  ): Promise<[number, number]>;
}

export class RedisStore {
  constructor(private client: RedisClient) {}
  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const member = `${now}:${randomUUID()}`;
    const [count, resetTime] = await this.client.eval(
      REDIS_SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now.toString(),
      windowMs.toString(),
      member,
    );
    return { count, resetTime };
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
  private hits = new Map<string, { timestamps: number[]; windowMs: number }>();
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
      const valid = data.timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, { timestamps: valid, windowMs: data.windowMs });
      }
    }
  }

  public async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;

    const data = this.hits.get(key) || { timestamps: [], windowMs };
    const timestamps = data.timestamps.filter((time) => time > windowStart);
    timestamps.push(now);

    this.hits.set(key, { timestamps, windowMs });
    if (this.hits.size > this.maxKeys) {
      this.prune();
      while (this.hits.size > this.maxKeys) {
        const oldestKey = this.hits.keys().next().value;
        if (oldestKey === undefined) break;
        this.hits.delete(oldestKey);
      }
    }

    const oldest = timestamps[0] ?? now;
    const resetTime = Math.ceil((oldest + windowMs) / 1000);

    return { count: timestamps.length, resetTime };
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
    if (options.skip?.(req)) return;

    const key = keyGenerator(req);
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
