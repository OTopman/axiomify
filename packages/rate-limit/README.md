# @axiomify/rate-limit

Sliding-window rate limiting for Axiomify. Supports in-memory (dev) and Redis (production).

## Install

```bash
npm install @axiomify/rate-limit
```

For Redis support, install your preferred client:
```bash
npm install ioredis   # or: npm install redis
```

## Quick start — global rate limit

```typescript
import { useRateLimit } from '@axiomify/rate-limit';
import { RedisStore } from '@axiomify/rate-limit';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const store = new RedisStore(redis);

useRateLimit(app, {
  windowMs: 60_000,  // 1-minute sliding window
  max: 100,          // 100 requests per IP per window
  store,
});
```

## Per-route rate limiting

```typescript
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const loginRateLimit = createRateLimitPlugin({
  windowMs: 15 * 60_000, // 15 minutes
  max: 5,
  store,
  keyGenerator: (req) => req.body?.email ?? req.ip, // key by email, not IP
});

app.route({
  method: 'POST',
  path: '/auth/login',
  plugins: [loginRateLimit],
  handler: async (req, res) => { /* ... */ },
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `windowMs` | `60000` (1 min) | Sliding window duration in milliseconds. |
| `max` | `100` | Maximum requests allowed per key per window. |
| `store` | auto | `RateLimitStore` to use. Defaults to `MemoryStore` (dev only). |
| `keyGenerator` | `req.ip` | Function to derive the rate-limit key per request. |
| `skip` | — | Return `true` to skip rate limiting for a request (e.g., internal IPs). |
| `allowMemoryStoreInProduction` | `false` | Must be `true` to use `MemoryStore` in `NODE_ENV=production`. |
| `memoryStoreMaxKeys` | `50000` | Maximum unique keys in `MemoryStore` before pruning. |

## RedisStore — EVALSHA caching

`RedisStore` uses a Lua sliding-window script. On the first call, it sends the full
script via `EVAL`. Subsequent calls use `EVALSHA` (the script's SHA1 hash) — Redis
only receives a 40-byte hash instead of the full Lua source. Falls back to `EVAL`
automatically on `NOSCRIPT` errors (e.g., after a Redis restart).

### ioredis

```typescript
import Redis from 'ioredis';
import { RedisStore } from '@axiomify/rate-limit';

const redis = new Redis(process.env.REDIS_URL);
const store = new RedisStore(redis);
```

### redis@4

```typescript
import { createClient } from 'redis';
import { RedisStore } from '@axiomify/rate-limit';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
const store = new RedisStore(redis as any);
```

## Response headers

Every rate-limited response includes:

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed per window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait (only on 429 responses) |

## MemoryStore

For development and testing only. **Not safe for production multi-process deployments** — each
worker process has its own counter. Effective rate limit becomes `max × numberOfWorkers`.

```typescript
import { MemoryStore } from '@axiomify/rate-limit';
const store = new MemoryStore({ maxKeys: 100_000 });
```

Call `store.close()` during graceful shutdown to clear the prune interval.
