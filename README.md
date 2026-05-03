# 🌌 Axiomify

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Schema-first. Adapter-driven. Production-ready.**

Axiomify is a high-performance Node.js framework that uses Zod schemas as a single source of truth for validation, TypeScript types, and OpenAPI documentation. Write your route once — run it on Express, Fastify, Hapi, native HTTP, or uWebSockets.js without changing a line of business logic.

---

## Architecture highlights

- **No double routing** — Each adapter registers routes directly with its own router (Express's, Fastify's C++ trie, Hapi's, uWS's C++). Axiomify's router is consulted at most once, only in the 404/405 fallback.
- **AJV-compiled validation** — Zod schemas are converted to JSON Schema 2020-12 via `z.toJSONSchema()` at startup, then compiled with AJV. Runtime cost: ~0.06µs valid / 0.12µs invalid — vs Zod's 0.30µs / 49.75µs.
- **Async-minimal hooks** — `HookManager.run()` returns synchronously for empty hook lists. Single-handler cases call the handler directly with no Promise wrapper. `onPreHandler` is only added to the pipeline at compile-time when handlers exist.
- **Multi-core clustering** — All adapters expose `listenClustered()`. Native uses SO_REUSEPORT (kernel-level distribution, zero IPC); others use Node.js cluster (round-robin).

---

## Package ecosystem

### Adapters

| Package | Description | Req/s (single core) |
|---|---|---:|
| [`@axiomify/native`](packages/native/) | uWebSockets.js — C++ routing, SO_REUSEPORT clustering | **50,000+** |
| [`@axiomify/fastify`](packages/fastify/) | Fastify 5 — recommended default | 10,000+ |
| [`@axiomify/http`](packages/http/) | Node.js `node:http` — zero dependencies | 10,000+ |
| [`@axiomify/hapi`](packages/hapi/) | Hapi 21 — enterprise-grade | 4,000+ |
| [`@axiomify/express`](packages/express/) | Express 4 — widest middleware ecosystem | 3,500+ |

Multi-core scaling (90% linear efficiency): 4 cores × 50k = **~180k req/s** (native), 4 cores × 10k = **~36k req/s** (fastify/http).

### Core

| Package | Description |
|---|---|
| [`@axiomify/core`](packages/core/) | Router, AJV validation compiler, hook manager, dispatcher |
| [`@axiomify/cli`](packages/cli/) | `axiomify init`, `dev`, `build`, `routes` visualisation |

### Security

| Package | Description |
|---|---|
| [`@axiomify/auth`](packages/auth/) | JWT auth + refresh-token rotation + **access token revocation via TokenStore** |
| [`@axiomify/cors`](packages/cors/) | CORS with strict preflight, Vary management, startup validation |
| [`@axiomify/helmet`](packages/helmet/) | 15 security headers (CSP, HSTS, COEP, COOP, CORP, …) |
| [`@axiomify/rate-limit`](packages/rate-limit/) | Sliding-window rate limiting + **EVALSHA caching** + ioredis/redis@4 support |
| [`@axiomify/security`](packages/security/) | XSS, HPP, SQLi heuristics, prototype pollution, null bytes, bot detection |
| [`@axiomify/fingerprint`](packages/fingerprint/) | Server-side request fingerprinting with confidence scoring |

### Content & I/O

| Package | Description |
|---|---|
| [`@axiomify/upload`](packages/upload/) | RAM-safe multipart streaming via Busboy + auto cleanup on error |
| [`@axiomify/static`](packages/static/) | Static file serving — 36 MIME types, configurable cache control, SPA index fallback |
| [`@axiomify/ws`](packages/ws/) | WebSocket management — rooms, broadcast, heartbeat, **all adapter compatible** |
| [`@axiomify/graphql`](packages/graphql/) | GraphQL endpoint + GraphiQL playground + depth/alias limits |

### Observability

| Package | Description |
|---|---|
| [`@axiomify/openapi`](packages/openapi/) | Auto-generate OpenAPI 3.0 from Zod schemas — **Zod v4 native via `z.toJSONSchema()`** |
| [`@axiomify/logger`](packages/logger/) | Structured logging with recursive PII masking |
| [`@axiomify/metrics`](packages/metrics/) | Prometheus metrics — bounded cardinality, WebSocket stats integration |

---

## Quick start

```bash
npx @axiomify/cli init my-api
cd my-api && npm install && npm run dev
```

Or manually:

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  handler: async (req, res) => {
    // req.body is typed and validated — { name: string, email: string }
    res.status(201).send({ id: '1', name: req.body.name });
  },
});

// Swap adapters without changing route definitions
new NativeAdapter(app, { port: 3000 }).listen(() => console.log('Ready on :3000'));
// new FastifyAdapter(app).listen(3000);
// new ExpressAdapter(app).listen(3000);
// new HttpAdapter(app).listen(3000);
```

---

## Multi-core clustering

All adapters support `listenClustered()`. The native adapter uses SO_REUSEPORT — the kernel distributes connections with zero user-space coordination:

```typescript
import { NativeAdapter } from '@axiomify/native';

const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });

adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} died — restarting`),
  // crashed workers restart automatically
});
```

```typescript
// Fastify and HTTP adapters use Node.js cluster (round-robin)
const fastifyAdapter = new FastifyAdapter(app, { workers: 4 });
fastifyAdapter.listenClustered(3000, { onWorkerReady: (port) => console.log(`[:${port}]`) });
```

---

## Validation

Axiomify compiles Zod schemas to AJV at startup — the same strategy Fastify uses:

```typescript
app.route({
  method: 'POST',
  path: '/orders',
  schema: {
    body: z.object({
      items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })),
      coupon: z.string().optional(),
    }),
    query: z.object({ dryRun: z.coerce.boolean().default(false) }),
    response: {
      201: z.object({ orderId: z.string(), total: z.number() }),
      400: z.object({ message: z.string(), errors: z.record(z.string()) }),
    },
  },
  handler: async (req, res) => {
    // req.body, req.query fully typed and validated
    // req.query.dryRun is boolean (coerced from string by Zod)
    res.status(201).send({ orderId: 'ord_1', total: 99.99 });
  },
});
```

Zod transforms (`.coerce`, `.default()`, `.transform()`) run after AJV validates structure. The compiled AJV function validates; `schema.parse()` applies transforms.

---

## Authentication with token revocation

```typescript
import { createAuthPlugin, createRefreshHandler, MemoryTokenStore } from '@axiomify/auth';

// Production: use Redis. MemoryTokenStore is per-process only.
const tokenStore = new MemoryTokenStore();

// Access token revocation: store.exists(jti) checked on every request
const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  store: tokenStore,
});

// Refresh token rotation with revocation
const refresh = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900,         // 15 min
  refreshTokenTtl: 2_592_000,  // 30 days
  store: tokenStore,
});

app.route({ method: 'POST', path: '/auth/refresh', handler: refresh });
app.route({
  method: 'GET', path: '/me',
  plugins: [requireAuth],
  handler: async (req, res) => res.send(req.state.authUser),
});
```

---

## Rate limiting with Redis EVALSHA

```typescript
import { RedisStore } from '@axiomify/rate-limit';
import Redis from 'ioredis';

// EVALSHA: script uploaded once, subsequent calls use 40-byte SHA hash
const store = new RedisStore(new Redis(process.env.REDIS_URL));

const loginLimit = createRateLimitPlugin({
  windowMs: 15 * 60_000,
  max: 5,
  store,
  keyGenerator: (req) => req.body?.email ?? req.ip,
});
```

---

## WebSockets — all adapters

```typescript
import { useWebSockets, getServerFromAdapter } from '@axiomify/ws';

// @axiomify/http — direct
const server = new HttpAdapter(app).listen(3000);
useWebSockets(app, { server, path: '/ws' });

// @axiomify/express, fastify, hapi — use getServerFromAdapter()
const expressAdapter = new ExpressAdapter(app);
const server = expressAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(expressAdapter), path: '/ws' });

// @axiomify/native — use built-in ws option instead
new NativeAdapter(app, {
  port: 3000,
  ws: { path: '/ws', open: (ws) => ws.send('hello') },
});
```

---

## OpenAPI — Zod v4 native

```typescript
import { useSwagger } from '@axiomify/openapi';

useSwagger(app, {
  info: { title: 'My API', version: '1.0.0' },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  security: [{ bearerAuth: [] }],
});
// Swagger UI at /docs, spec at /docs/openapi.json
```

Uses `z.toJSONSchema()` (built into Zod v4) — no third-party schema bridge. Works with all standard Zod types including `z.enum()`, `z.union()`, `z.optional()`, `z.array()`.

---

## Static files

```typescript
import { serveStatic } from '@axiomify/static';

// Content-hashed assets (immutable)
serveStatic(app, {
  prefix: '/assets',
  root: './dist/assets',
  cacheControl: 'public, max-age=31536000, immutable',
});

// SPA fallback — serve index.html for all unmatched paths
serveStatic(app, {
  prefix: '/',
  root: './dist',
  cacheControl: 'no-cache',
  serveIndex: true,
});
```

36 MIME types, ETag caching, path traversal protection, configurable `Cache-Control`.

---

## Hooks

```typescript
// Global — runs on every request
app.addHook('onRequest',    (req, res) => { /* before routing */ });
app.addHook('onPreHandler', (req, res, match) => { /* after routing, before handler */ });
app.addHook('onPostHandler',(req, res, match) => { /* after handler */ });
app.addHook('onError',      (err, req, res) => { /* handler threw */ });
app.addHook('onClose',      (req, res) => { /* always last */ });

// Route groups with shared plugins
app.group('/api/v1', { plugins: [requireAuth] }, (v1) => {
  v1.route({ method: 'GET', path: '/me', handler: getMeHandler });
  v1.group('/admin', { plugins: [requireAdmin] }, (admin) => {
    admin.route({ method: 'DELETE', path: '/users/:id', handler: deleteUserHandler });
  });
});
```

---

## Benchmarks (autocannon · 100 connections · pipelining 10 · 12s · Node 22)

### Single process

| Server | Req/s | Avg lat | p99 |
|---|---:|---:|---:|
| Node.js http (bare) | 27,800 | 36ms | 54ms |
| Fastify 5 (bare) | 27,065 | 36ms | 56ms |
| **Axiomify Native (uWS)** | **50,493** | **20ms** | **41ms** |
| Axiomify + Fastify | 10,487 | 95ms | 180ms |
| Axiomify + HTTP | 9,965 | 100ms | 191ms |
| Axiomify + Hapi | 4,955 | 200ms | 1,261ms |
| Axiomify + Express | 3,787 | 225ms | 2,478ms |

### Multi-core projections (90% linear scaling)

| Adapter | 1 core | 4 cores | 8 cores |
|---|---:|---:|---:|
| Native (uWS) | 50k | **~182k** | **~363k** |
| Fastify | 10.5k | **~38k** | **~75k** |
| HTTP | 10k | **~36k** | **~72k** |

---

## Security by default

- **Prototype pollution** — all adapters sanitize `__proto__`, `constructor`, `prototype` from JSON bodies
- **AJV strict validation** — `coerceTypes: false`, `removeAdditional: false` — no silent data mutation
- **JWT algorithm pinning** — `createAuthPlugin` rejects tokens signed with non-listed algorithms; weak secrets throw at startup
- **CORS startup validation** — `credentials: true` + `origin: '*'` throws instead of silently misconfiguring
- **Path traversal** — `@axiomify/static` uses `realpath()` + root containment check on every request
- **Body stream limits** — all adapters enforce body size on the actual stream (not just Content-Length headers)

---

## Testing

```bash
npm test         # vitest — 306 tests, 34 test files
npm run coverage # V8 coverage report
```

Test suite includes:
- **Cross-adapter parity tests** (`describe.each` across all 4 HTTP adapters) — same behaviour guaranteed
- Unit tests for every package
- Integration tests with real HTTP round-trips (no mocking the adapter layer)

---

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, first route, first adapter |
| [Core concepts](docs/core-concepts.md) | Routing, validation, hooks, serialiser |
| [Adapters guide](docs/adapters.md) | Choosing and configuring adapters |
| [Plugins & hooks](docs/plugins-and-hooks.md) | Writing plugins, hook execution order |
| [Production checklist](docs/production-checklist.md) | Security, clustering, health checks |
| [Examples](examples/) | Runnable servers for every adapter and plugin |

### Package docs

[core](docs/packages/core.md) · [auth](docs/packages/auth.md) · [cors](docs/packages/cors.md) · [rate-limit](docs/packages/rate-limit.md) · [ws](docs/packages/ws.md) · [openapi](docs/packages/openapi.md) · [security](docs/packages/security.md) · [static](docs/packages/static.md) · [upload](docs/packages/upload.md) · [helmet](docs/packages/helmet.md) · [logger](docs/packages/logger.md) · [metrics](docs/packages/metrics.md) · [fingerprint](docs/packages/fingerprint.md) · [graphql](docs/packages/graphql.md)

---

## Contributing

PRs welcome. All code requires:
- Strict TypeScript (`strict: true`, no `any` in production paths)
- Tests with Vitest (unit + integration)
- Conventional commit messages
- Zero new `any` types in public API surface

---

## License

MIT
