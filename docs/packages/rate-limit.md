# @axiomify/rate-limit

Sliding-window rate limiting for global or route-level enforcement.

## Install

```bash
npm install @axiomify/rate-limit
```

## Exports

- `createRateLimitPlugin(options?)`
- `useRateLimit(app, options?)`
- `MemoryStore`
- `RedisStore`

## Options

- `windowMs`
- `max`
- `maxRequests`
- `store`
- `keyGenerator`
- `keyExtractor`
- `skip`

`maxRequests` and `keyExtractor` are supported aliases for the documented route examples.

## Example

```ts
const limiter = createRateLimitPlugin({
  windowMs: 60_000,
  maxRequests: 100,
  keyExtractor: (req) => req.user?.id ?? req.ip,
});

app.route({
  method: 'POST',
  path: '/jobs',
  plugins: [requireAuth, limiter],
  handler: async (_req, res) => res.send({ ok: true }),
});
```

## Global Mode

Use `useRateLimit(app, ...)` when you want one limiter to apply broadly in `onPreHandler`.
