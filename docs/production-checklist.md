# Production Checklist

## Native Performance

Axiomify uses a highly optimized C++ Native HTTP server powered by uWebSockets.js.

- **Single Core:** Expect ~73-84k req/s for a "Hello World"
- **Multi-Core (Linux):** Scales near-linearly utilizing `SO_REUSEPORT`. Expect ~200k+ req/s on a 4-core machine.
*Numbers vary heavily based on load-generator limits. Run load generator on a separate network machine for accurate multi-core numbers.*

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
- [ ] `trustProxy` only when behind a known proxy
- [ ] `maxBodySize` set at adapter level for payload limitations

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

- [ ] `adapter.close()` called on SIGTERM

## Observability

- [ ] `@axiomify/metrics` endpoint protected (network policy or `protect` callback)
- [ ] `X-Request-Id` propagated to downstream services and logs
- [ ] Request ID captured in logger context per request
