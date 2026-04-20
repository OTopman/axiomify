import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

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

/**
 * Use MemoryStore for single-process apps. Use RedisStore for PM2 clusters or multi-instance deployments.
 */
export class RedisStore {
  constructor(private client: RedisClient) {}
  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local windowStart = now - window
      redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
      redis.call('ZADD', key, now, now)
      redis.call('PEXPIRE', key, window)
      local count = redis.call('ZCARD', key)
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local resetTime = oldest[2] and math.ceil((tonumber(oldest[2]) + window) / 1000) or math.ceil((now + window) / 1000)
      return {count, resetTime}
    `;
    const [count, resetTime] = await this.client.eval(
      script,
      1,
      key,
      now.toString(),
      windowMs.toString(),
    );
    return { count, resetTime };
  }
}

export class MemoryStore implements RateLimitStore {
  private hits = new Map<string, { timestamps: number[]; windowMs: number }>();
  private timer: NodeJS.Timeout;

  constructor() {
    // Prune expired keys every 60 seconds to prevent OOM DoS attacks
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref(); // Don't block the Node event loop from exiting
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

    // resetTime is when the *oldest* request in the current window ages out.
    // The previous implementation used `windowStart + windowMs`, which
    // algebraically simplifies to `now` — i.e. "right now" — and was
    // therefore meaningless. When the map is empty, fall back to now+window.
    const oldest = timestamps[0] ?? now;
    const resetTime = Math.ceil((oldest + windowMs) / 1000);

    return {
      count: timestamps.length,
      resetTime,
    };
  }
}

export interface RateLimitOptions {
  windowMs?: number; // Default: 60000 (1 minute)
  max?: number; // Default: 100 requests per window
  maxRequests?: number; // Alias for max
  store?: RateLimitStore;
  keyGenerator?: (req: AxiomifyRequest) => string;
  keyExtractor?: (req: AxiomifyRequest) => string; // Alias for keyGenerator
  skip?: (req: AxiomifyRequest) => boolean;
}

/**
 * Shared handler used by both `useRateLimit` (global onPreHandler) and
 * `createRateLimitPlugin` (per-route). Keeps a single source of truth for
 * limit enforcement, headers, and response short-circuiting.
 */
function buildLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? options.maxRequests ?? 100;
  const store = options.store ?? new MemoryStore();
  const keyGenerator =
    options.keyGenerator ??
    options.keyExtractor ??
    ((req: AxiomifyRequest) => req.ip || '127.0.0.1');

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

/**
 * @example
 * keyGenerator: (req) => (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.ip
 */
export function createRateLimitPlugin(options: RateLimitOptions = {}) {
  return buildLimiter(options);
}

export function useRateLimit(
  app: Axiomify,
  options: RateLimitOptions = {},
): void {
  const limiter = buildLimiter(options);
  // We use onPreHandler so we can eventually read route-specific metadata if needed
  app.addHook('onPreHandler', async (req, res) => {
    await limiter(req, res);
  });
}
