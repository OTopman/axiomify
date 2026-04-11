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

export class MemoryStore implements RateLimitStore {
  private hits = new Map<string, number[]>();

  public async increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Sliding window: filter out timestamps older than the window
    let timestamps = this.hits.get(key) || [];
    timestamps = timestamps.filter((time) => time > windowStart);
    timestamps.push(now);

    this.hits.set(key, timestamps);

    return {
      count: timestamps.length,
      resetTime: Math.ceil((windowStart + windowMs) / 1000),
    };
  }
}

export interface RateLimitOptions {
  windowMs?: number; // Default: 60000 (1 minute)
  max?: number; // Default: 100 requests per window
  store?: RateLimitStore;
  keyGenerator?: (req: AxiomifyRequest) => string;
  skip?: (req: AxiomifyRequest) => boolean;
}

export function useRateLimit(
  app: Axiomify,
  options: RateLimitOptions = {},
): void {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const store = options.store ?? new MemoryStore();

  // Default key generator uses IP. If behind a proxy, ensure req.ip resolves correctly.
  const keyGenerator = options.keyGenerator ?? ((req) => req.ip || '127.0.0.1');

  // We use onPreHandler so we can eventually read route-specific metadata if needed
  app.addHook(
    'onPreHandler',
    async (req: AxiomifyRequest, res: AxiomifyResponse) => {
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
      }
    },
  );
}
