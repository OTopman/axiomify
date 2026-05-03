# Production Checklist

## Adapter selection

| Adapter | When to use | Single-core | 4-core cluster |
|---|---|---|---|
| `@axiomify/native` | Maximum throughput, no middleware | 50k req/s | ~180k req/s |
| `@axiomify/fastify` | High throughput + Fastify ecosystem | 10k req/s | ~38k req/s |
| `@axiomify/http` | Minimal footprint, edge/serverless | 10k req/s | ~36k req/s |
| `@axiomify/express` | Legacy middleware compatibility | 4k req/s | ~14k req/s |
| `@axiomify/hapi` | Hapi plugin ecosystem | 4k req/s | ~14k req/s |

## Multi-core deployment

All adapters support `listenClustered()`. Workers bind the same port via the OS:

```typescript
const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary: (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} died`, code),
});
```

## Security

- [ ] `@axiomify/helmet` applied on every adapter (not just the primary one)
- [ ] `@axiomify/cors` — explicit `origin`, never `'*'` in production
- [ ] `@axiomify/rate-limit` with Redis store on all public routes
- [ ] JWT secret ≥ 32 chars, from env var only — never in code
- [ ] Body size limits set at adapter level (`bodyLimit`, `bodyLimitBytes`)
- [ ] `trustProxy` only enabled when actually behind a known proxy

## Auth

- [ ] Access token TTL ≤ 15 minutes
- [ ] Refresh token rotation enabled (`store` configured in `createRefreshHandler`)
- [ ] Access token revocation via `store` in `createAuthPlugin` (if immediate logout needed)
- [ ] Rate limit `/auth/refresh` — 10 req/min per IP

## Validation

- [ ] Every route with a body has a Zod `schema.body` — never validate in the handler
- [ ] Path params validated with Zod (`schema.params`) — never trust raw `:id`
- [ ] Response schemas defined for API stability (`schema.response`)

## Rate limiting

- [ ] `RedisStore` (not `MemoryStore`) in multi-process or multi-container deployments
- [ ] Key generator uses user ID for authenticated routes, IP for public routes

## WebSockets

- [ ] `maxConnections` set explicitly (default: 10,000)
- [ ] `authenticate` callback configured — never accept unauthenticated connections in production
- [ ] `ws.close()` called on SIGTERM before `adapter.close()`

## Observability

- [ ] `@axiomify/logger` configured with `sensitiveFields` for auth headers
- [ ] `@axiomify/metrics` endpoint protected (`protect` option or network policy)
- [ ] X-Request-Id propagated to downstream services and logs

## OpenAPI

- [ ] `useSwagger` protected with `protect` callback or disabled in production
- [ ] All routes have `tags` and `description` for discoverability
