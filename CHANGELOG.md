# Changelog

## [5.0.0] — 2026-05-07

### ⚠️ Breaking changes

#### `X-Request-Id` is now opt-in

In v4, `X-Request-Id` was injected automatically on every response. This paid a per-request cost even in apps that never needed it.

**Migration:** call `app.enableRequestId()` after construction:

```ts
// v4 — automatic
const app = new Axiomify();

// v5 — explicit opt-in
const app = new Axiomify();
app.enableRequestId();
```

#### `app.serializer` is now a read-only getter

Direct assignment (`app.serializer = fn`) is no longer possible — it bypassed arity normalisation.

**Migration:** `app.setSerializer(fn)` — already the documented API, no logic change.

#### `lockRoutes()` and `handleMatchedRoute()` require `ADAPTER_LOCK_TOKEN`

**Impact:** only custom adapter authors. Application code is unaffected.

```ts
import { ADAPTER_LOCK_TOKEN } from '@axiomify/core';

// v4
app.lockRoutes('@my/adapter');

// v5
app.lockRoutes(ADAPTER_LOCK_TOKEN, '@my/adapter');
await app.handleMatchedRoute(ADAPTER_LOCK_TOKEN, req, res, route, params);
```

#### `RoutePlugin` / `PluginHandler` deprecated (removed v6)

Replaced by `RouteMiddleware`. Deprecated aliases remain exported for this release.

#### `res.sseInit()` / `res.sseSend()` are now optional on `AxiomifyResponse`

Check `res.capabilities.sse` before calling. Use `SseCapableResponse` for typed access.

#### Clustering default: `os.cpus().length` → `os.availableParallelism()`

Respects container CPU limits. Equivalent on bare-metal. May differ in Docker/Kubernetes with `--cpus` set.

---

### 🆕 New packages

#### `@axiomify/native` — uWebSockets.js adapter

Highest-throughput Axiomify adapter. C++ routing via per-route uWS registration, SO_REUSEPORT clustering, Express-compatible middleware bridge.

Benchmarked on 8-core machine: **73,511–83,947 req/s** single-process.

```ts
import { NativeAdapter } from '@axiomify/native';
const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listenClustered({
  onPrimary: (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} exited (${code})`),
});
```

#### `@axiomify/graphql` — GraphQL endpoint

Drop-in GraphQL with GraphiQL 3 playground, per-request context, `maxDepth`/`maxAliases` limits.

#### `@axiomify/security` — XSS / HPP / SQLi / prototype pollution

Request-level heuristics: XSS detection, HTTP Parameter Pollution normalisation, SQL injection heuristics, null-byte filtering, bot detection.

#### `@axiomify/fingerprint` — Request fingerprinting

Confidence-scored server-side fingerprint from headers, TLS signals, and behavioural patterns.

---

### ⚡ Performance

#### Validator: AJV + transform-aware fast path

`hasTransforms()` walks the Zod schema tree once at startup. Schemas with no `.transform()`, `.default()`, `.coerce`, or `.refine()` skip `schema.parse()` on every request — AJV's output is returned directly.

- **15–25% throughput gain on validated routes** (typical REST schemas have no transforms)
- **428× faster** invalid-path error collection (AJV vs Zod)
- Removed unnecessary pre-AJV shallow-clone (`coerceTypes: false` means AJV never mutates input)
- `Object.defineProperty` replaced with direct assignment on `req.body/query/params` (restores V8 hidden-class fast path)

#### Core: microtask-free hook fast path

`HookManager.run()` returns `undefined` for empty hook lists. No Promise allocation, no microtask queued. Single-handler lists bypass the loop.

#### Core: allocation reduction

- `ValidatingResponse` wrapper skipped for schema-less non-HEAD routes
- Router writes params into caller-provided `req.params` — no intermediate object
- Single-step pipeline unrolled (handler-only routes skip the for-loop)

#### Clustering: verified 160–165% scaling at 2 workers (8-core, co-located loadgen)

| Adapter | 1w | 2w | Scaling |
|---|---:|---:|---:|
| `@axiomify/http` | 35,800 | 57,200 | **160%** |
| `@axiomify/fastify` | 21,300 | 35,200 | **165%** |
| Native (uWS) | 85,000 | 91,300 | 107%† |

† Native is loadgen-limited at co-located ~90k req/s. Dedicated loadgen gives near-linear scaling.

---

### 🔧 Clustering fixes (all adapters)

`cluster.SCHED_NONE` now set before first fork. Workers bind via `reusePort: true` (Node ≥ 16.9) or `exclusive: true` (older Node). Primary process is no longer in the request hot path.

Additional:
- **Crash circuit breaker** — 5+ crashes in 30 s aborts primary (prevents runaway respawn on bad config)
- **SIGUSR2 rolling restart** — `kill -USR2 <pid>` for zero-downtime reload
- **Oversubscription warning** when `workers > os.availableParallelism()`
- **`@axiomify/hapi`** — pre-binds `net.Server` with `reusePort`, injects as Hapi listener (Hapi has no native `reusePort` API)

---

### 🆕 New core APIs

#### `app.enableRequestId()`

Opt-in X-Request-Id injection. Module-level monotonic counter (shared across instances, truly per-process). Respects upstream `x-request-id` headers.

#### `AxiomifyOptions.logger`

```ts
import pino from 'pino';
const app = new Axiomify({ logger: pino() });
```

Replaces hardcoded `console.error` calls in `HookManager` and `ValidationCompiler`. Strongly recommended in production.

#### New exports from `@axiomify/core`

| Export | Description |
|---|---|
| `ADAPTER_LOCK_TOKEN` | `unique symbol` for `lockRoutes()` / `handleMatchedRoute()` |
| `AdapterLockToken` | TypeScript type of the token |
| `AxiomifyLogger` | `{ warn, error }` injectable logger interface |
| `defaultLogger` | `console`-backed default implementation |

#### `AppModule` / `AppConfigurator` / `AppContext`

Structured module system with topological dependency resolution (Kahn's algorithm). Pass modules in any order — the framework resolves them.

#### `RouteMeta`

Documentation metadata (`tags`, `description`, `summary`, `security`) separated from `RouteSchema`, which contains only validation-relevant fields.

#### `ResponseCapabilities` / `SseCapableResponse`

Explicit capability detection for SSE and streaming, replacing implicit method availability.

---

### 📦 Ecosystem upgrades

#### `@axiomify/openapi` — Zod v4 native

Uses `z.toJSONSchema()` (Zod v4 built-in). Removes dependency on `zod-to-json-schema`, which returned `{}` for all Zod v4 schemas.

#### `@axiomify/auth`

- Access token revocation via `TokenStore` (Redis or memory)
- Refresh token rotation with configurable TTL
- JWT algorithm pinning — rejects tokens with non-listed algorithms
- Weak secrets throw at startup (< 32 chars)

#### `@axiomify/rate-limit`

- EVALSHA caching — Lua script uploaded once, subsequent calls use 40-byte SHA
- `ioredis` and `redis@4` both supported

#### `@axiomify/logger`

- Removed `maskify-ts` dependency (had hard `reflect-metadata` runtime requirement)
- Inline recursive PII masking with configurable field list

#### `@axiomify/ws`

- `getServerFromAdapter()` helper for all HTTP adapters
- `@axiomify/native` uses uWS built-in WebSocket (not `ws` library)

#### `@axiomify/security`

- XSS pattern detection
- HTTP Parameter Pollution normalisation
- SQL injection heuristics
- Prototype pollution, null-byte filtering
- Basic bot/crawler detection

---

### 🧪 Tests

321 tests, 37 test files, 0 failures. All new packages include unit + integration tests.
Cross-adapter parity tests use `describe.each(ADAPTERS)` — same behaviour guaranteed across all HTTP adapters.

---

## [4.0.0] — 2026-03-15

Initial public release of the Axiomify monorepo with core, adapters, and plugin packages.
