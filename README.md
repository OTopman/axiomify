# 🌌 Axiomify

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
 
**Schema-first. Uncompromising Performance. Production-ready.**

Axiomify is an ultra high-performance Node.js framework built exclusively on `uWebSockets.js` that uses Zod schemas as a single source of truth for validation, TypeScript types, and OpenAPI documentation. It is engineered from the ground up for zero-overhead routing, strict security, and raw throughput.

---

## Architecture highlights

- **Native C++ Routing (production)** — `@axiomify/native` registers every route directly with `uWebSockets.js` so HTTP requests are routed in C++. A JS radix trie (`packages/core/src/router.ts`) is built at startup and used only by `app.handle()` — the test / SSR entrypoint that bypasses the native adapter. Production traffic never touches the JS router.
- **Compiled validation** — Zod schemas are converted to JSON Schema 2020-12 once at route registration time and compiled by AJV. Per-request validation runs the compiled AJV function; `schema.parse()` is called only when the schema declares transforms. Falls back to Zod `safeParse` (~1.6× slower but always correct) when AJV is not installed.
- **Microtask-free hooks** — `HookManager.run()` returns `undefined` for empty hook lists. No Promise allocation, no microtask in the zero-hook fast path. Hook arrays are snapshotted before iteration so hooks added during a request take effect on the next request.
- **Linux SO_REUSEPORT clustering** — `listenClustered()` forks one uWS app per worker; each worker binds the same port via uWS's `SO_REUSEPORT` support on Linux. The kernel distributes connections at the socket layer — zero IPC in the request hot path. On macOS / Windows, clustering requires an explicit `allowUserspaceProxy: true` opt-in because the userspace L4 proxy fallback defeats the perf rationale.

---

## Package ecosystem



| Package | Description |
|---|---|
| [`@axiomify/core`](packages/core/) | Router, AJV validation, hook manager, dispatcher, module system |
| [`@axiomify/cli`](packages/cli/) | `init` · `dev` · `build` · `routes` · `openapi` · `check` · `doctor` |

### Security

| Package | Description |
|---|---|
| [`@axiomify/auth`](packages/auth/) | JWT + refresh rotation + access token revocation via `TokenStore` (`MemoryTokenStore` shipped; Redis/DB stores BYO via the `TokenStore` interface) |
| [`@axiomify/cors`](packages/cors/) | CORS with strict preflight, `Vary` management, startup validation |
| [`@axiomify/helmet`](packages/helmet/) | 15 security headers (CSP, HSTS, COEP, COOP, CORP, …) |
| [`@axiomify/rate-limit`](packages/rate-limit/) | Sliding-window rate limiting + EVALSHA caching + ioredis/redis@4 |
| [`@axiomify/security`](packages/security/) | XSS sanitisation, HPP normalisation, prototype-pollution + null-byte filtering, bot UA detection; opt-in narrow Mongo-operator detector |
| [`@axiomify/fingerprint`](packages/fingerprint/) | Server-side request fingerprinting with confidence scoring |

### Content & I/O

| Package | Description |
|---|---|
| [`@axiomify/upload`](packages/upload/) | RAM-safe multipart streaming via Busboy + auto cleanup on error |
| [`@axiomify/static`](packages/static/) | Static file serving — 36 MIME types, ETag, SPA index fallback |
| [`@axiomify/graphql`](packages/graphql/) | GraphQL endpoint + GraphiQL 3 + depth/alias limits |
| [`@axiomify/socket.io`](packages/socket.io/) | Socket.IO 4.4+ bridge — attaches to the same uWS server as HTTP, so one process serves both |

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

app.ws({
  path: '/chat',
  schema: { message: z.object({ text: z.string() }) },
  message: (client, data) => {
    // data is typed and validated — { text: string }
    client.send({ reply: `Echo: ${data.text}` });
  }
});

new NativeAdapter(app, { port: 3000 }).listen(() => console.log('Ready on :3000'));
```

---

## Multi-core clustering

The `NativeAdapter` supports `listenClustered()`. Since v5, it uses SO_REUSEPORT — each worker owns its socket, with zero IPC in the request hot path.

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

## Validation in action

Zod schemas are converted to JSON Schema 2020-12 at route registration and compiled by AJV. Per-request validation runs the compiled function; transforms (`.default()`, `.coerce.*`, `.transform()`) trigger a second `schema.parse()` pass on the valid path. Unknown-key behaviour is controlled by your Zod schema (`.strict()` / `.passthrough()` / default), not by the framework.

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

// `MemoryTokenStore` is per-process. For multi-process or multi-host
// deployments, implement the `TokenStore` interface against Redis / DB /
// your store of choice — see [Auth Reference](./docs/packages/auth.md).
const tokenStore = new MemoryTokenStore();

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
  handler: async (req, res) => res.send(req.state.user),
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

## Native WebSockets

Axiomify Native integrates `uWebSockets.js` directly into the core router. You can define WebSocket routes just like HTTP routes, with full support for plugins, schema validation on incoming messages, and route groups.

```typescript
app.ws({
  path: '/chat',
  schema: {
    message: z.object({ text: z.string() })
  },
  plugins: [requireAuth],
  open: (client, req) => {
    client.send({ type: 'welcome', user: req.state.user.id });
  },
  message: (client, data) => {
    // data is strongly typed as { text: string } and already validated
    client.send({ reply: `Echo: ${data.text}` });
  },
  close: (client, code, reason) => {
    console.log(`Connection closed: ${code} - ${reason}`);
  }
});
```

---

## OpenAPI — Zod v4 native

```typescript
import { useOpenAPI } from '@axiomify/openapi';

useOpenAPI(app, {
  info: { title: 'My API', version: '1.0.0' },
  prefix: '/docs',
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
});
// Swagger UI at /docs, spec at /docs/openapi.json
```

Uses `z.toJSONSchema()` (Zod v4 built-in, emits JSON Schema 2020-12). No third-party schema bridge needed. Per-route docs live on `route.openapi` and mirror the [OAS 3.0.3 Operation Object](https://spec.openapis.org/oas/v3.0.3#operation-object) verbatim — see [docs/[./packages/openapi.md](./packages/openapi.md)](docs/packages/openapi.md).

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
import { MemoryTokenStore, type TokenStore } from '@axiomify/auth';

// Modules with topological dependency resolution
app.use({
  name: 'auth',
  dependencies: ['cors'],   // cors is registered before auth, regardless of call order
  register: (app, ctx) => {
    // MemoryTokenStore for single-process; supply your own TokenStore impl
    // backed by Redis / DB / etc. for multi-process or multi-host deployments.
    const tokenStore: TokenStore = new MemoryTokenStore();
    ctx.provide('tokenStore', tokenStore);
    app.addHook('onRequest', verifyToken);
  },
});
```

---

## CLI

`@axiomify/cli` ships with the framework. Beyond `init` / `dev` / `build`, it has commands for route inspection, OpenAPI generation, production-readiness auditing, and environment diagnostics — useful in CI as well as locally.

```bash
npx axiomify routes                      # colour-coded route table (HTTP + WS)
npx axiomify openapi -o openapi.json     # emit spec for client codegen
npx axiomify check                       # static production-readiness audit
npx axiomify doctor                      # diagnose Node version / uWS / ports
```

`axiomify routes` example:

```
┌─────────┬──────────────────────┬───────────────┬───────────────────────────────────────┐
│ METHOD  │ PATH                 │ VALIDATION    │ META                                  │
├─────────┼──────────────────────┼───────────────┼───────────────────────────────────────┤
│ WS      │ /chat                │ Message       │ —                                     │
│ GET     │ /health              │ —             │ —                                     │
│ POST    │ /users ⊘ DEPRECATED  │ Body,Response │ op:createUser #Users 5000ms +1 plugin │
│ GET     │ /users/:id           │ Params        │ op:getUser #Users                     │
│ DELETE  │ /users/:id           │ Params        │ —                                     │
└─────────┴──────────────────────┴───────────────┴───────────────────────────────────────┘

  ✓ 5 routes   DELETE 1 · GET 2 · POST 1 · WS 1
    └ 1 WebSocket route included
```

Flags: `--json` (machine-readable), `--method GET,POST,WS`, `--filter "/api/v1/*"`, `--sort path|method`. WebSocket routes (`app.ws(...)`) are listed alongside HTTP routes — earlier CLI versions silently omitted them.

In CI:

```yaml
- run: npx axiomify doctor                                              # env sanity
- run: npx axiomify check                                               # readiness gate (exit 1 on fail)
- run: npx axiomify build
- run: npx axiomify openapi -o openapi.json --spec-version "$GITHUB_SHA"
- run: npx axiomify routes --json > routes.json                          # API surface snapshot
```

Full reference: [docs/[./packages/cli.md](./packages/cli.md)](docs/packages/cli.md).

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

### Clustered (8-core, co-located loadgen)

| Adapter | 1 worker | 2 workers | Scaling |
|---|---:|---:|---:|
| Native (uWS) | 85,000 | 91,300 | 107%† |

† Native is autocannon-limited at ~90k req/s co-located. Dedicated loadgen gives near-linear scaling.

For authoritative clustered numbers: `SERVER_HOST=<server-ip> node benchmarks/run-clustered.mjs`

---

## Security defaults

- **Prototype pollution** — when `@axiomify/security` is registered, the sanitiser walks `req.body` / `req.query` / `req.params` and drops `__proto__` / `constructor` / `prototype` keys. Enabled by default.
- **AJV non-coercing** — `coerceTypes: false` and no `removeAdditional` flag — AJV never mutates request data silently. Validation rejects on bad shape; transforms only run if you declared them in your Zod schema.
- **JWT algorithm pinning** — `createAuthPlugin` and `createRefreshHandler` reject tokens signed with algorithms not in the configured list. Weak secrets (< 32 bytes / 256 bits per RFC 7518) throw at startup in production, warn in development.
- **CORS startup validation** — `credentials: true` combined with a literal `origin: '*'` throws at construction time, not on first request.
- **Path traversal** — `@axiomify/static` resolves via `realpath()` and verifies containment under the configured root.
- **Body stream limits** — `NativeAdapter` enforces `maxBodySize` on the actual byte stream from uWS, not the Client-controlled `Content-Length` header.
- **Header injection** — `res.header(name, value)` throws on CR / LF / NUL bytes in either argument, preventing response-splitting attacks.

---

## Testing

```bash
npm test         # vitest — 524 tests across 50 files
npm run coverage # V8 coverage report (97% lines / 98% functions on gated packages)
```

- Unit tests for every package
- Integration tests against a real `uWebSockets.js` listener (Linux + Node ≤22)
- Header-injection regression tests and property-based fuzz coverage of the query parser via `fast-check`
- Smoke benchmark in CI (`benchmarks/smoke.mjs`); see `benchmarks/README.md` for the full perf harness

---

## Migration from v4

See [CHANGELOG.md](CHANGELOG.md) for the full list of breaking changes.

Quick reference:

| v4 | v5 |
|---|---|
| `new Axiomify()` injects X-Request-Id automatically | Opt in with `app.enableRequestId()` |
| `app.lockRoutes(reason)` (any caller could lock) | `app.lockRoutes(ADAPTER_LOCK_TOKEN, reason)` (token-gated for adapters) |
| `meta: { tags, summary, ... }` on routes | `openapi: { tags, summary, ... }` — `meta` still works through 5.x, removed in 6.0 |
| 5-arg `SerializerFn(data, msg, code, isErr, req)` | `SerializerFn(input)` only — the 5-arg form throws at construction time in 5.0 |
| `AppPlugin` type alias | Removed; use `AppConfigurator`. Runtime accepts 1-arg fns identically |
| `useSwagger` import | `useOpenAPI` (the function was never named `useSwagger` in shipped code; older docs were wrong) |
| `routePrefix: '/docs'` on `useOpenAPI` | `prefix: '/docs'` (matches `@axiomify/static`); `routePrefix` warns + still works through 5.x |
| Node.js cluster round-robin | SO_REUSEPORT (Linux kernel load-balancing); non-Linux requires `allowUserspaceProxy: true` opt-in |

---

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, first route, first adapter |
| [Core concepts](docs/core-concepts.md) | Routing, validation, hooks, serialiser |
| [Plugins & hooks](docs/plugins-and-hooks.md) | Writing plugins, hook execution order |
| [Production checklist](docs/production-checklist.md) | Security, clustering, health checks |
| [Examples](examples/) | Runnable servers showing the full ecosystem |

### Package docs

[core](docs/packages/core.md) · [native](docs/packages/native.md) (HTTP + WebSocket adapter) · [auth](docs/packages/auth.md) · [cors](docs/packages/cors.md) · [rate-limit](docs/packages/rate-limit.md) · [openapi](docs/packages/openapi.md) · [security](docs/packages/security.md) · [static](docs/packages/static.md) · [upload](docs/packages/upload.md) · [helmet](docs/packages/helmet.md) · [logger](docs/packages/logger.md) · [metrics](docs/packages/metrics.md) · [fingerprint](docs/packages/fingerprint.md) · [graphql](docs/packages/graphql.md) · [cli](docs/packages/cli.md)

---

## Contributing

PRs welcome. All code requires strict TypeScript (`strict: true`, no `any` in production paths), Vitest tests (unit + integration), and conventional commit messages.

---

## License

MIT
