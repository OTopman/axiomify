# 🌌 Axiomify

[![npm version](https://img.shields.io/npm/v/@axiomify/core.svg)](https://npmjs.com/package/@axiomify/core)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Schema-first. Uncompromising Performance. Production-ready.**

Axiomify is an ultra high-performance Node.js framework built exclusively on `uWebSockets.js` that uses Zod schemas as a single source of truth for validation, TypeScript types, and OpenAPI documentation. It is engineered from the ground up for zero-overhead routing, strict security, and raw throughput.

---

## Architecture highlights

- **Native C++ Routing (production)** — `@axiomify/native` registers every route directly with `uWebSockets.js` so HTTP requests are routed in C++. A JS radix trie (`packages/core/src/router.ts`) is built at startup and used only by `app.handle()` — the test / SSR entrypoint that bypasses the native adapter. Production traffic never touches the JS router.
- **Zod-Native Security** — strict validation pipeline using `schema.parse()` to automatically strip unknown payload keys and prevent Mass Assignment and Prototype Pollution attacks.
- **Microtask-free hooks** — `HookManager.run()` returns `undefined` for empty hook lists. No Promise allocation, no microtask in the zero-hook fast path.
- **True SO_REUSEPORT clustering** — natively sets `cluster.SCHED_NONE` before the first fork and binds each worker via `reusePort: true`. Workers own their sockets — zero IPC in the request hot path.

---

## Package ecosystem



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

Axiomify executes Zod validation directly using `schema.parse()`. Unknown keys are automatically stripped from payloads to prevent Mass Assignment and Prototype Pollution attacks before your business logic is reached.

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
    client.send({ type: 'welcome', user: req.state.authUser.id });
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

### Clustered (8-core, co-located loadgen)

| Adapter | 1 worker | 2 workers | Scaling |
|---|---:|---:|---:|
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
