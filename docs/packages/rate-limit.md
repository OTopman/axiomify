# @axiomify/rate-limit

Sliding-window rate limiting with Redis EVALSHA caching and full `redis@4` / `ioredis` compatibility.

## Install

```bash
npm install @axiomify/rate-limit
# Redis client (choose one):
npm install ioredis        # recommended
npm install redis          # redis@4
```

## API

| Export | Description |
|---|---|
| `createRateLimitPlugin(options)` | Per-route plugin — attach via `plugins: [limiter]` |
| `useRateLimit(app, options)` | Global rate limit via `onPreHandler` hook |
| `MemoryStore` | In-process store — dev/testing only |
| `RedisStore` | Redis-backed store — production |

## Global rate limit

```typescript
import { useRateLimit, RedisStore } from '@axiomify/rate-limit';
import Redis from 'ioredis';

const store = new RedisStore(new Redis(process.env.REDIS_URL));

useRateLimit(app, {
  windowMs: 60_000,   // 1-minute sliding window
  max: 100,           // 100 req/IP/window
  store,
});
```

## Per-route rate limit

```typescript
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const loginLimit = createRateLimitPlugin({
  windowMs: 15 * 60_000,  // 15 minutes
  max: 5,                 // 5 attempts
  store,
  keyGenerator: (req) => req.body?.email ?? req.ip,
});

app.route({
  method: 'POST',
  path: '/auth/login',
  plugins: [loginLimit],
  handler: async (req, res) => { /* ... */ },
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `windowMs` | `60000` | Sliding window in milliseconds. |
| `max` | `100` | Max requests per key per window. |
| `store` | `MemoryStore` | `RateLimitStore` implementation. |
| `keyGenerator` | `req.ip` | Derive rate-limit key from the request. |
| `keyExtractor` | — | Alias for `keyGenerator`. |
| `maxRequests` | — | Alias for `max`. |
| `skip` | — | Return `true` to skip limiting for a specific request. |
| `allowMemoryStoreInProduction` | `false` | Set `true` to explicitly allow `MemoryStore` in production. |
| `memoryStoreMaxKeys` | `50000` | Max keys in `MemoryStore` before pruning. |

## RedisStore — EVALSHA caching

`RedisStore` uses a Lua sliding-window script. The script is uploaded once via `EVAL`,
then subsequent calls use `EVALSHA` (40-byte SHA1) instead of the full Lua source:

- **First call:** `EVAL <script>` → Redis caches the script and returns the SHA
- **Subsequent calls:** `EVALSHA <sha>` → Redis executes the cached script directly
- **On `NOSCRIPT`** (Redis restart / flush): automatically falls back to `EVAL` and
  re-establishes EVALSHA for the next call

### ioredis

```typescript
import Redis from 'ioredis';
import { RedisStore } from '@axiomify/rate-limit';

const store = new RedisStore(new Redis(process.env.REDIS_URL));
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

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Requests left in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait (429 responses only) |

## Custom key generators

```typescript
// Key by authenticated user ID (after auth plugin)
createRateLimitPlugin({
  store,
  max: 1000,
  keyGenerator: (req) => req.state.authUser?.id ?? req.ip,
});

// Key by API key header
createRateLimitPlugin({
  store,
  max: 500,
  keyGenerator: (req) => String(req.headers['x-api-key'] ?? req.ip),
});

// Skip internal/health-check IPs
createRateLimitPlugin({
  store,
  skip: (req) => req.ip === '127.0.0.1',
});
```

## MemoryStore

In-process, single-server only. **Never use in multi-process or multi-instance deployments** — 
each worker maintains its own counter independently. Effective limit becomes `max × workers`.

```typescript
import { MemoryStore } from '@axiomify/rate-limit';

const store = new MemoryStore({ maxKeys: 100_000 });
// Call store.close() on graceful shutdown to clear the prune interval
```
