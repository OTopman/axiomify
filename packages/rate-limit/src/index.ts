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

    const oldest = timestamps[0] ?? now;
    const resetTime = Math.ceil((oldest + windowMs) / 1000);

    return { count: timestamps.length, resetTime };
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

function createStore(provided?: RateLimitStore): RateLimitStore {
  if (provided) return provided;

  if (process.env.NODE_ENV === 'production' && !_emittedStoreWarning) {
    _emittedStoreWarning = true;
    console.warn(
      '[axiomify/rate-limit] Using in-memory MemoryStore in production. ' +
        'MemoryStore is per-process: each Node.js worker or container instance ' +
        'maintains its own counter, so the effective rate limit is ' +
        'max × numberOfProcesses. Provide a RedisStore for multi-process or ' +
        'multi-instance deployments.',
    );
  }

  return new MemoryStore();
}

function buildLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? options.maxRequests ?? 100;
  const store = createStore(options.store);
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
