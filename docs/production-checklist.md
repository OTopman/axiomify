# Production Checklist

> **Tip:** before going through this list manually, run the static auditor — it covers most of the routine items automatically and exits 1 on real defects, so you can wire it into CI:
>
> ```bash
> npx axiomify check    # static readiness audit
> npx axiomify doctor   # host environment diagnostic
> ```
>
> The remaining items below are things only you can verify (network topology, real secrets, SLO budgets).

## Native Performance

Axiomify uses a highly optimized C++ Native HTTP server powered by uWebSockets.js.

- **Single Core:** Expect ~73-84k req/s for a "Hello World"
- **Multi-Core (Linux):** Scales near-linearly utilizing `SO_REUSEPORT`. Expect ~200k+ req/s on a 4-core machine.
  _Numbers vary heavily based on load-generator limits. Run load generator on a separate network machine for accurate multi-core numbers._

## Multi-core deployment (Linux)

```typescript
// Use availableParallelism() — respects container CPU limits
const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary: (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} died (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

`listenClustered()` uses `SO_REUSEPORT` and is **Linux-only by default**. On macOS / Windows it throws unless you pass `allowUserspaceProxy: true` to the `NativeAdapter` constructor — the non-Linux path falls back to a userspace L4 proxy that defeats uWS's perf rationale and is intended for development only.

## Clustering checklist

- [ ] **Deploy on Linux.** macOS/Windows clustering requires `allowUserspaceProxy: true` and is dev-only
- [ ] `workers` set explicitly — do not rely on defaults in containers
- [ ] `workers` ≤ `os.availableParallelism()` — oversubscription degrades throughput
- [ ] `gracefulTimeoutMs` ≥ your p99 latency × 2
- [ ] Verify SO_REUSEPORT: `lsof -i :PORT` shows N processes each owning a LISTEN socket
- [ ] SIGTERM drain tested in staging — confirm in-flight requests complete before exit
- [ ] SIGUSR2 rolling restart tested before production use

## Security

- [ ] `app.enableRequestId()` called (opt-in since v5)
- [ ] `@axiomify/helmet` registered for CSP / HSTS / COOP / CORP / framing headers
- [ ] `@axiomify/cors` — explicit `origin` list, never `'*'` in production; `credentials: true` combined with `'*'` **or** `true` (reflect-all) throws at startup
- [ ] `@axiomify/rate-limit` with `RedisStore` on all public routes (multi-process / multi-host deployments require Redis, not MemoryStore)
- [ ] JWT secret ≥ **32 bytes (256 bits)** per RFC 7518 §3.2 — the framework throws in production on weaker secrets. Generate one via `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
- [ ] JWT algorithms pinned via `createAuthPlugin({ algorithms: ['HS256'] })` — `'none'` is always rejected
- [ ] `trustProxy: true` ONLY when running behind a proxy you control (otherwise clients can forge `X-Forwarded-For`)
- [ ] `maxBodySize` set on `NativeAdapter` — enforced on the actual byte stream, not just `Content-Length`
- [ ] User-controlled values are never passed directly to `res.header(name, value)` without first stripping CR/LF (the framework throws on CRLF/NUL in 5.0, but defensive sanitisation upstream is still recommended)
- [ ] Response streams (`res.stream`, `res.sseSend`) are aware of the per-response backpressure caps (8 MiB stream, 1 MiB SSE) — slow consumers get their connections closed, not OOM the process

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

## Graceful shutdown

- [ ] `adapter.gracefulShutdown({ onShutdown, timeoutMs })` wired up — this is the unified entry point for both HTTP and WebSocket drain
- [ ] `onShutdown` closes DB pools, flushes logger buffers, releases any external resources
- [ ] `timeoutMs` greater than your slowest expected drain (e.g. p99 latency × 2)
- [ ] **Do NOT** call `gracefulShutdown()` from `@axiomify/core` against a NativeAdapter — that helper is for `http.Server`, not uWS. Use `adapter.gracefulShutdown()` instead

## Observability

- [ ] `@axiomify/metrics` endpoint protected (network policy or `protect` callback)
- [ ] `X-Request-Id` propagated to downstream services and logs
- [ ] Request ID captured in logger context per request
