# 🌌 Axiomify

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Schema-first. Adapter-driven. Production-ready.**

Axiomify is a high-performance Node.js framework that uses Zod schemas as a single source of truth for validation, TypeScript types, and OpenAPI documentation. Write your route once — run it on uWebSockets.js, native HTTP, Fastify, Hapi, or Express without changing a line of business logic.

---

## Architecture highlights

- **No double routing** — each adapter registers routes directly with its own router (uWS C++, Fastify's C++ trie, Hapi's, Express's). Axiomify's radix-trie router is consulted only in the 404/405 fallback.
- **AJV-compiled validation** — Zod schemas converted to JSON Schema 2020-12 via `z.toJSONSchema()` at startup, compiled with AJV. Runtime cost: ~0.06 µs valid / 0.12 µs invalid — vs Zod's 0.30 µs / 49.75 µs. Transform-free schemas skip `schema.parse()` entirely (15–25% throughput gain on validated routes).
- **Microtask-free hooks** — `HookManager.run()` returns `undefined` for empty hook lists. No Promise allocation, no microtask in the zero-hook fast path.
- **True SO_REUSEPORT clustering** — all adapters set `cluster.SCHED_NONE` before the first fork and bind each worker via `reusePort: true`. Workers own their sockets — zero IPC in the request hot path. Measured 160–165% scaling at 2 workers on 8-core hardware.

---

## Package ecosystem

### Adapters

| Package | Description | Req/s (single-core) |
|---|---|---:|
| [`@axiomify/native`](packages/native/) | uWebSockets.js — C++ routing, SO_REUSEPORT | **73,000–84,000** |
| [`@axiomify/http`](packages/http/) | Node.js `node:http` — zero dependencies | 32,800 |
| [`@axiomify/fastify`](packages/fastify/) | Fastify 5 | 31,300 |
| [`@axiomify/hapi`](packages/hapi/) | Hapi 21 — enterprise-grade | 9,900 |
| [`@axiomify/express`](packages/express/) | Express 4 — widest middleware ecosystem | 7,300 |

*8-core machine, autocannon 100 conns, pipelining 10, 12 s, co-located loadgen.*

### Core

| Package | Description |
|---|---|
| [`@axiomify/core`](packages/core/) | Router, AJV validation, hook manager, dispatcher, module system |
| [`@axiomify/cli`](packages/cli/) | `axiomify init`, `dev`, `build`, `routes` visualisation |

### Security

| Package | Description |
|---|---|
| [`@axiomify/auth`](packages/auth/) | JWT + refresh rotation + access token revocation via `TokenStore` |
| [`@axiomify/cors`](packages/cors/) | CORS with strict preflight, `Vary` management, startup validation |
| [`@axiomify/helmet`](packages/helmet/) | 15 security headers (CSP, HSTS, COEP, COOP, CORP, …) |
| [`@axiomify/rate-limit`](packages/rate-limit/) | Sliding-window rate limiting + EVALSHA caching + ioredis/redis@4 |
| [`@axiomify/security`](packages/security/) | XSS, HPP, SQLi heuristics, prototype pollution, null bytes, bot detection |
| [`@axiomify/fingerprint`](packages/fingerprint/) | Server-side request fingerprinting with confidence scoring |

### Content & I/O

| Package | Description |
|---|---|
| [`@axiomify/upload`](packages/upload/) | RAM-safe multipart streaming via Busboy + auto cleanup on error |
| [`@axiomify/static`](packages/static/) | Static file serving — 36 MIME types, ETag, SPA index fallback |
| [`@axiomify/ws`](packages/ws/) | WebSocket rooms, broadcast, heartbeat — all adapters compatible |
| [`@axiomify/graphql`](packages/graphql/) | GraphQL endpoint + GraphiQL 3 + depth/alias limits |

### Observability

| Package | Description |
|---|---|
| [`@axiomify/openapi`](packages/openapi/) | OpenAPI 3.0 from Zod schemas — Zod v4 native via `z.toJSONSchema()` |
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
app.enableRequestId(); // opt-in X-Request-Id injection

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  handler: async (req, res) => {
    // req.body is typed and validated — { name: string, email: string }
    res.status(201).send({ id: 'usr_1', name: req.body.name });
  },
});

// Swap adapters without changing any route or handler
new NativeAdapter(app, { port: 3000 }).listen(() => console.log('Ready on :3000'));
// new HttpAdapter(app).listen(3000);
// new FastifyAdapter(app).listen(3000);
```

---

## Multi-core clustering

All adapters support `listenClustered()`. Since v5, all adapters use SO_REUSEPORT — each worker owns its socket, with zero IPC in the request hot path.

```typescript
import { NativeAdapter } from '@axiomify/native';

const adapter = new NativeAdapter(app, { port: 3000 });

adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

```typescript
// HTTP, Fastify, Express, Hapi — identical API
const adapter = new HttpAdapter(app, { workers: 4 });
adapter.listenClustered(3000, {
  onPrimary:    (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} died`, code),
});
```

Zero-downtime reload: `kill -USR2 <primary-pid>` — restarts workers one at a time.

Workers default to `os.availableParallelism()` (respects Docker `--cpus` / Kubernetes `cpu:`). Never set `workers` above the physical core count available to your container.

---

## Validation

Axiomify compiles Zod schemas to AJV at startup. `hasTransforms()` detects at compile time whether a schema needs the second Zod pass — schemas with no `.transform()`, `.default()`, `.coerce`, or `.refine()` return the AJV-validated data directly.

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
    // req.body typed and validated. req.query.dryRun is boolean (coerced).
    res.status(201).send({ orderId: 'ord_1', total: 99.99 });
  },
});
```

---

## Authentication with token revocation

```typescript
import { createAuthPlugin, createRefreshHandler, MemoryTokenStore } from '@axiomify/auth';

const tokenStore = new MemoryTokenStore(); // use RedisTokenStore in production

const requireAuth = createAuthPlugin({
  secret: process.env.JWT_SECRET!,
  store: tokenStore,
});

const refresh = createRefreshHandler({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessTokenTtl: 900,
  refreshTokenTtl: 2_592_000,
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
import { createRateLimitPlugin, RedisStore } from '@axiomify/rate-limit';
import Redis from 'ioredis';

const store = new RedisStore(new Redis(process.env.REDIS_URL));

const loginLimit = createRateLimitPlugin({
  windowMs: 15 * 60_000,
  max: 5,
  store,
  keyGenerator: (req) => req.body?.email ?? req.ip,
});
```

---

## WebSockets

```typescript
import { useWebSockets, getServerFromAdapter } from '@axiomify/ws';

// @axiomify/http — direct
const server = new HttpAdapter(app).listen(3000);
useWebSockets(app, { server, path: '/ws' });

// @axiomify/express, fastify, hapi — use getServerFromAdapter()
const adapter = new ExpressAdapter(app);
const server = adapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(adapter), path: '/ws' });

// @axiomify/native — use built-in uWS WebSocket
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
});
// Swagger UI at /docs, spec at /docs/openapi.json
```

Uses `z.toJSONSchema()` (Zod v4 built-in, emits JSON Schema 2020-12). No third-party schema bridge needed.

---

## Hooks

```typescript
app.addHook('onRequest',    (req, res) => { /* before routing */ });
app.addHook('onPreHandler', (req, res, match) => { /* after routing */ });
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

## Module system

```typescript
// Modules with topological dependency resolution
app.use({
  name: 'auth',
  dependencies: ['cors'],   // cors is registered before auth, regardless of call order
  register: (app, ctx) => {
    ctx.provide('tokenStore', new RedisTokenStore(redis));
    app.addHook('onRequest', verifyToken);
  },
});
```

---

## Benchmarks (autocannon · 100 conns · pipelining 10 · 12 s · Node 22 · 8-core)

### Single process

| Server | Req/s | Avg lat | p99 |
|---|---:|---:|---:|
| Node.js http (bare) | 43,765 | 22 ms | 54 ms |
| Fastify 5 (bare) | 41,779 | 23 ms | 53 ms |
| **Axiomify Native — GET /users/:id/posts/:postId** | **83,947** | **11 ms** | **20 ms** |
| **Axiomify Native — GET /ping** | **73,511** | **13 ms** | **26 ms** |
| **Axiomify Native — POST /echo** | **54,720** | **18 ms** | **30 ms** |
| Axiomify + `@axiomify/http` | 32,841 | 30 ms | 91 ms |
| Axiomify + `@axiomify/fastify` | 31,334 | 31 ms | 58 ms |

The ~25% dispatcher overhead vs bare adapters is the fixed cost of hook iteration, compiled-state lookup, and async pipeline — identical across all adapters.

### Clustered (8-core, co-located loadgen)

| Adapter | 1 worker | 2 workers | Scaling |
|---|---:|---:|---:|
| `@axiomify/http` | 35,800 | 57,200 | **160%** |
| `@axiomify/fastify` | 21,300 | 35,200 | **165%** |
| Native (uWS) | 85,000 | 91,300 | 107%† |

† Native is autocannon-limited at ~90k req/s co-located. Dedicated loadgen gives near-linear scaling.

For authoritative clustered numbers: `SERVER_HOST=<server-ip> node benchmarks/run-clustered.mjs`

---

## Security defaults

- **Prototype pollution** — adapters strip `__proto__`, `constructor`, `prototype` from JSON bodies (opt-in via `sanitize: true`)
- **AJV strict mode** — `coerceTypes: false`, no `removeAdditional` — no silent data mutation
- **JWT algorithm pinning** — `createAuthPlugin` rejects tokens signed with non-listed algorithms; weak secrets throw at startup
- **CORS startup validation** — `credentials: true` + `origin: '*'` throws at startup
- **Path traversal** — `@axiomify/static` uses `realpath()` + root containment check
- **Body stream limits** — all adapters enforce size on the actual stream, not just `Content-Length`

---

## Testing

```bash
npm test         # vitest — 321 tests, 37 test files
npm run coverage # V8 coverage report
```

- Cross-adapter parity tests (`describe.each` across all adapters) — identical behaviour guaranteed
- Unit + integration tests for every package
- Real HTTP round-trips (no adapter-layer mocking)

---

## Migration from v4

See [CHANGELOG.md](CHANGELOG.md) for the full list of breaking changes.

Quick reference:

| v4 | v5 |
|---|---|
| `new Axiomify()` injects X-Request-Id | `app.enableRequestId()` to opt in |
| `app.serializer = fn` | `app.setSerializer(fn)` |
| `app.lockRoutes(reason)` | `app.lockRoutes(ADAPTER_LOCK_TOKEN, reason)` |
| `RoutePlugin` / `PluginHandler` | `RouteMiddleware` |
| Node.js cluster round-robin | SO_REUSEPORT (kernel load-balancing) |

---

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, first route, first adapter |
| [Core concepts](docs/core-concepts.md) | Routing, validation, hooks, serialiser |
| [Adapters guide](docs/adapters.md) | Choosing, configuring, clustering |
| [Plugins & hooks](docs/plugins-and-hooks.md) | Writing plugins, hook execution order |
| [Production checklist](docs/production-checklist.md) | Security, clustering, health checks |
| [Examples](examples/) | Runnable servers for every adapter and plugin |

### Package docs

[core](docs/packages/core.md) · [native](docs/packages/native.md) · [auth](docs/packages/auth.md) · [cors](docs/packages/cors.md) · [rate-limit](docs/packages/rate-limit.md) · [ws](docs/packages/ws.md) · [openapi](docs/packages/openapi.md) · [security](docs/packages/security.md) · [static](docs/packages/static.md) · [upload](docs/packages/upload.md) · [helmet](docs/packages/helmet.md) · [logger](docs/packages/logger.md) · [metrics](docs/packages/metrics.md) · [fingerprint](docs/packages/fingerprint.md) · [graphql](docs/packages/graphql.md)

---

## Contributing

PRs welcome. All code requires strict TypeScript (`strict: true`, no `any` in production paths), Vitest tests (unit + integration), and conventional commit messages.

---

## License

MIT
