# @axiomify/rate-limit

Sliding-window rate limiting for Axiomify with Redis EVALSHA caching.

## API

- `createRateLimitPlugin(options)` — per-route plugin
- `useRateLimit(app, options)` — global rate limit via `onPreHandler` hook
- `MemoryStore` — in-process store (testing only)
- `RedisStore` — Redis-backed store; compatible with `redis@4` and `ioredis`

## EVALSHA caching

`RedisStore` sends the Lua script to Redis once on first call, then uses `EVALSHA` (script hash) on subsequent calls. No script re-upload on every request — the script is identified by SHA1 only.

On `NOSCRIPT` errors (Redis flush/restart), `RedisStore` falls back to `EVAL` automatically and re-establishes EVALSHA for the next call.

## Redis client compatibility

```typescript
// redis@4
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
new RedisStore(redis);

// ioredis
import Redis from 'ioredis';
new RedisStore(new Redis(process.env.REDIS_URL));
```

## Response headers

```
X-RateLimit-Limit:     100
X-RateLimit-Remaining: 73
X-RateLimit-Reset:     1718000000
Retry-After:           60          (on 429 only)
```
