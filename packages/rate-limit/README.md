# @axiomify/rate-limit

Sliding-window rate limiting with in-memory or Redis backing. Supports per-route enforcement and distributed clustering.

## Installation

```bash
npm install @axiomify/rate-limit
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { createRateLimitPlugin } from '@axiomify/rate-limit';

const app = new Axiomify();

// Create a rate limiter: 100 requests per 15 minutes
const limiter = createRateLimitPlugin({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  keyExtractor: (req) => req.headers['x-forwarded-for'] || req.ip,
});

// Apply to a specific route
app.route({
  method: 'POST',
  path: '/api/auth/login',
  plugins: [limiter],
  handler: async (req, res) => {
    return res.send({ ok: true });
  },
});
```

## Features

- **Sliding Window**: Accurate, per-second rate limiting (not fixed buckets)
- **Flexible Key Extraction**: Rate limit by IP, user ID, API key, hostname, etc.
- **In-Memory & Redis**: Use `MemoryStore` for single-process apps or `RedisStore` for distributed systems
- **Custom Responses**: Customize the 429 response message
- **Zero Breaking Changes**: All v3.x APIs remain compatible

## API Reference

### `createRateLimitPlugin(options)`

Creates a rate limiting plugin that can be applied to routes.

**Options:**

```typescript
interface RateLimitOptions {
  store?: RateLimitStore;                    // MemoryStore or RedisStore (default: MemoryStore)
  windowMs: number;                          // Time window in milliseconds
  maxRequests: number;                       // Max requests per window
  keyExtractor: (req: AxiomifyRequest) => string; // Extract the rate limit key
  message?: string | ((req, res) => void);   // Custom 429 response
  statusCode?: number;                       // HTTP status (default: 429)
  skip?: (req: AxiomifyRequest) => boolean;  // Skip rate limiting (e.g., for health checks)
}
```

### `MemoryStore`

In-process memory storage for single-process apps.

```typescript
import { MemoryStore, createRateLimitPlugin } from '@axiomify/rate-limit';

const store = new MemoryStore();
const limiter = createRateLimitPlugin({
  store,
  windowMs: 1000,
  maxRequests: 10,
  keyExtractor: (req) => req.ip,
});
```

### `RedisStore`

Distributed Redis storage for multi-process and multi-server apps.

```typescript
import { RedisStore, createRateLimitPlugin } from '@axiomify/rate-limit';
import Redis from 'redis';

const redis = Redis.createClient();
const store = new RedisStore(redis);

const limiter = createRateLimitPlugin({
  store,
  windowMs: 1000,
  maxRequests: 10,
  keyExtractor: (req) => req.user?.id || req.ip,
});
```

## Examples

### Basic: Rate Limit by IP

```typescript
const limiter = createRateLimitPlugin({
  windowMs: 60_000,         // 1 minute
  maxRequests: 30,          // 30 requests per minute
  keyExtractor: (req) => req.headers['x-forwarded-for'] || req.ip,
});

app.route({
  method: 'GET',
  path: '/api/search',
  plugins: [limiter],
  handler: async (req, res) => {
    return res.send({ results: [] });
  },
});
```

### Strict: Rate Limit by User ID

```typescript
const limiter = createRateLimitPlugin({
  windowMs: 60_000,
  maxRequests: 100,
  keyExtractor: (req) => req.user?.id || 'anonymous',
});

app.route({
  method: 'POST',
  path: '/api/jobs/create',
  plugins: [requireAuth, limiter],
  handler: async (req, res) => {
    // Authenticated users get 100 requests/minute, each
    return res.send({ jobId: 'job-123' });
  },
});
```

### Custom: Rate Limit by API Key

```typescript
const limiter = createRateLimitPlugin({
  windowMs: 3600_000,       // 1 hour
  maxRequests: 1000,        // 1000 requests per hour
  keyExtractor: (req) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) return 'anonymous';
    return `apikey:${apiKey}`;
  },
});
```

### Distributed: Redis-backed Rate Limiting

```typescript
import Redis from 'redis';
import { RedisStore, createRateLimitPlugin } from '@axiomify/rate-limit';

const redis = Redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

const limiter = createRateLimitPlugin({
  store: new RedisStore(redis),
  windowMs: 1000,
  maxRequests: 100,
  keyExtractor: (req) => req.user?.id || req.ip,
});
// Now the rate limit is shared across all your servers
```

### PM2 Clustering

For PM2 multi-instance deployments, use Redis:

```typescript
// app.js
const Redis = require('redis');
const { RedisStore, createRateLimitPlugin } = require('@axiomify/rate-limit');

const redis = Redis.createClient();
const limiter = createRateLimitPlugin({
  store: new RedisStore(redis),
  windowMs: 60_000,
  maxRequests: 1000,
  keyExtractor: (req) => req.user?.id || req.ip,
});
```

```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api',
    script: './app.js',
    instances: 4,
  }],
};
```

All 4 instances share the same rate limit counters via Redis.

### Skip Rate Limiting for Health Checks

```typescript
const limiter = createRateLimitPlugin({
  windowMs: 1000,
  maxRequests: 100,
  keyExtractor: (req) => req.ip,
  skip: (req) => req.path === '/health',
});
```

### Custom 429 Response

```typescript
const limiter = createRateLimitPlugin({
  windowMs: 60_000,
  maxRequests: 30,
  keyExtractor: (req) => req.ip,
  message: 'Too many requests. Please try again later.',
  // Or via function:
  message: (req, res) => {
    res.status(429).send({
      error: 'Rate limit exceeded',
      retryAfter: req.rateLimit?.resetTime,
    });
  },
});
```

## How Sliding Window Works

Unlike fixed-bucket rate limiting (which can spike at bucket boundaries), sliding window is smooth:

```
Time:     0s      5s      10s     15s     20s
Request:  x       x x     x       x x     x x
Bucket:   [-----5s-----] [-----5s-----]

Sliding window:         [-----5s-----]
                                    [-----5s-----]

Fixed buckets can allow 20 requests in 6s at the boundary.
Sliding window maintains a strict ~10 requests per 5s.
```

## Response Headers

When rate-limited, the response includes:

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1713607261

{
  "error": "Too many requests"
}
```

## Testing

```typescript
it('enforces rate limit by IP', async () => {
  // Make 31 requests (limit is 30)
  for (let i = 0; i < 31; i++) {
    const res = await fetch('http://localhost:3000/api/search', {
      headers: { 'X-Forwarded-For': '192.168.1.1' },
    });
    if (i < 30) {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(429);
    }
  }
});

it('allows different IPs independent limits', async () => {
  const res1 = await fetch('http://localhost:3000/api/search', {
    headers: { 'X-Forwarded-For': '192.168.1.1' },
  });
  const res2 = await fetch('http://localhost:3000/api/search', {
    headers: { 'X-Forwarded-For': '192.168.1.2' },
  });
  
  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200); // Different IP, independent limit
});
```

## Storage Comparison

| Feature | MemoryStore | RedisStore |
| --- | --- | --- |
| Process Count | 1 | ∞ (distributed) |
| Setup | Zero config | Requires Redis |
| Memory Usage | Low | Redis handles |
| Failover | N/A | Automatic (with Redis cluster) |
| Best For | Development, single-server | Production, multi-server |

## Troubleshooting

**Q: Rate limit isn't working across my 4 PM2 instances**

A: Switch to RedisStore instead of MemoryStore:

```typescript
// ❌ Before (separate limits per process)
const limiter = createRateLimitPlugin({
  windowMs: 1000,
  maxRequests: 100,
  keyExtractor: (req) => req.ip,
  // Uses MemoryStore by default — NOT shared!
});

// ✅ After (shared limit across all processes)
const { RedisStore } = require('@axiomify/rate-limit');
const redis = require('redis').createClient();
const limiter = createRateLimitPlugin({
  store: new RedisStore(redis),
  windowMs: 1000,
  maxRequests: 100,
  keyExtractor: (req) => req.ip,
});
```

**Q: How do I rate limit based on API key (not IP)?**

A: Use a custom keyExtractor:

```typescript
keyExtractor: (req) => {
  const apiKey = req.headers['x-api-key'] as string;
  return apiKey ? `key:${apiKey}` : `ip:${req.ip}`;
}
```

**Q: Can I have different limits for different endpoints?**

A: Yes, create separate limiters:

```typescript
const publicLimiter = createRateLimitPlugin({ windowMs: 1000, maxRequests: 30 });
const authLimiter = createRateLimitPlugin({ windowMs: 1000, maxRequests: 1000 });

app.route({ path: '/api/search', plugins: [publicLimiter], /* ... */ });
app.route({ path: '/api/data', plugins: [requireAuth, authLimiter], /* ... */ });
```

## License

MIT
