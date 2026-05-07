# Production Checklist

## Adapter selection

| Adapter | When to use | Single-core | 2-worker |
|---|---|---:|---:|
| `@axiomify/native` | Maximum throughput | 73–84k req/s | ~91k† |
| `@axiomify/http` | Minimal footprint, edge/serverless | 32.8k | 57.2k |
| `@axiomify/fastify` | Fastify plugin ecosystem | 31.3k | 35.2k |
| `@axiomify/express` | Legacy middleware | 7.3k | — |
| `@axiomify/hapi` | Hapi ecosystem | 9.9k | — |

*8-core, co-located loadgen. † Native is autocannon-limited co-located. Dedicated loadgen gives higher numbers.*

## Multi-core deployment

```typescript
// Use availableParallelism() — respects container CPU limits
const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} died (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

## Clustering checklist

- [ ] `workers` set explicitly — do not rely on defaults in containers
- [ ] `workers` ≤ `os.availableParallelism()` — oversubscription degrades throughput
- [ ] `gracefulTimeoutMs` ≥ your p99 latency × 2
- [ ] Verify SO_REUSEPORT: `lsof -i :PORT` shows N processes each owning a LISTEN socket
- [ ] SIGTERM drain tested in staging — confirm in-flight requests complete before exit
- [ ] SIGUSR2 rolling restart tested before production use

## Security

- [ ] `app.enableRequestId()` called (opt-in since v5)
- [ ] `@axiomify/helmet` applied on every adapter
- [ ] `@axiomify/cors` — explicit `origin` list, never `'*'` in production
- [ ] `@axiomify/rate-limit` with `RedisStore` on all public routes
- [ ] JWT secret ≥ 32 chars, from env var only
- [ ] `bodyLimitBytes` set at adapter level
- [ ] `trustProxy` only when behind a known proxy
- [ ] `sanitize: true` in adapter options for prototype pollution protection

## Logging

- [ ] Custom `AxiomifyLogger` injected: `new Axiomify({ logger: pino() })`
- [ ] Default `console` logging is not suitable for production observability stacks
- [ ] `@axiomify/logger` configured with `sensitiveFields` for auth headers

## Auth

- [ ] Access token TTL ≤ 15 minutes
- [ ] Refresh token rotation enabled (`store` in `createRefreshHandler`)
- [ ] Access token revocation via `store` in `createAuthPlugin` if immediate logout needed
- [ ] Rate limit `/auth/refresh` — 10 req/min per IP

## Validation

- [ ] Every route with a body has `schema.body`
- [ ] Path params validated with `schema.params` — never trust raw `:id`
- [ ] Response schemas defined for API contract stability
- [ ] `NODE_ENV=production` set — response-schema mismatches log and continue (not throw)

## Rate limiting

- [ ] `RedisStore` (not `MemoryStore`) in multi-process or multi-container deployments
- [ ] Key generator uses authenticated user ID for protected routes

## WebSockets

- [ ] `maxConnections` set explicitly (default: 10,000)
- [ ] `authenticate` callback configured
- [ ] `ws.close()` called on SIGTERM before `adapter.close()`

## Observability

- [ ] `@axiomify/metrics` endpoint protected (network policy or `protect` callback)
- [ ] `X-Request-Id` propagated to downstream services and logs
- [ ] Request ID captured in logger context per request
