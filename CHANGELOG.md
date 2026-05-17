# Changelog

## [Unreleased] — staged for `6.0.0-rc.1`

This entry tracks the deprecation-removal pass that follows the 5.0
work below. Every API marked `@deprecated` in 5.x is now gone. The 5.x
audit work itself remains the feature baseline — this section just lists
what was removed on top.

### ⚠️ Breaking — every 5.x-deprecated API is removed

| Removed | Migration |
|---|---|
| `RouteMeta` type alias | Use `OpenApiOperation`. `import { OpenApiOperation } from '@axiomify/core';` |
| `RouteDefinition.meta` field | Rename to `openapi`. Identical shape — paste your `meta: {...}` body under `openapi: {...}`. |
| `useOpenAPI({ routePrefix })` option | Rename to `prefix`. |
| `useSecurity({ sqlInjectionProtection, sqlPatterns })` options | Removed without replacement. Use parameterised queries at the DB layer — regex SQL detection was always a false-positive generator and trivially bypassable. |
| `DEFAULT_SQL_PATTERNS` / `detectSqlInjection` exports from `@axiomify/security/utils/detector` | Removed. See above. |
| `AxiomifyResponse.error(err)` method (and `NativeResponse.error`) | Use `res.status(500).send(null, msg)` directly — the helper was always a less-flexible alias. |
| `ValidatingResponse.error` wrapper in the dispatcher | Removed — `error()` is no longer part of `AxiomifyResponse`. |

The `axiomify migrate` command applies the mechanical renames (`meta` →
`openapi`, `RouteMeta` → `OpenApiOperation`, etc) automatically; the
`res.error()` and `sqlInjectionProtection` removals require by-hand
audit because they touch handler bodies and security posture.

After migration, run:

```bash
npx axiomify check     # exits 1 on remaining `meta:` usage, etc.
```

`axiomify check` now treats `meta:` on a route definition as a hard FAIL
(not a warning) — the field is unrecognised in 6.0, so silently
shipping with it loses your OpenAPI docs surface entirely.

### ✨ New: `@axiomify/socket.io`

Native Socket.IO 4.4+ bridge — attaches to the same `uWebSockets.js`
server that `@axiomify/native` already runs, so a single process serves
HTTP, native WebSocket routes (`app.ws()`), AND Socket.IO. No proxy in
front, no second Node listener, no port juggling.

```ts
import { attachSocketIO, adaptAxiomifyPlugin } from '@axiomify/socket.io';

const io = await attachSocketIO(adapter, {
  cors: { origin: 'https://app.example.com' },
});

// Reuse Axiomify auth / rate-limit / fingerprint plugins on socket
// connection upgrades — no code duplication.
io.use(adaptAxiomifyPlugin(requireAuth));
io.on('connection', (socket) => {
  socket.emit('welcome', { user: socket.data.user?.id });
});
```

The bridge wires `io.close()` into `adapter.gracefulShutdown()` so
long-lived clients get a proper `disconnect` frame on deploy instead of
a TCP reset. Disable with `drainOnAdapterShutdown: false` if you want
to manage Socket.IO's lifecycle yourself.

This required a small adapter-internal API addition: `NativeAdapter`
now exposes `getRawServer(token)` and `registerShutdownCallback(token, cb)`
behind the existing `ADAPTER_LOCK_TOKEN` gate. Both are documented as
plugin-bridge-only — calling them from user code throws. This is the
same authentication pattern `lockRoutes()` and `handleMatchedRoute()`
already use.

See [docs/packages/socket.io.md](./docs/packages/socket.io.md) for the
full reference + production checklist.

### Cleanup

- The runtime no-op `sqlInjectionProtection: true` warning shim from
  5.0 is gone. Setting that option now produces a TypeScript compile
  error (excess property) instead of a runtime warning.
- The `useOpenAPI` runtime `routePrefix` deprecation warning is gone.
- `route.meta` is no longer read by the OpenAPI generator — routes
  carrying it produce no operation metadata.

### Tests

- 484 passing (down from 486 by 2 — both removed tests pinned the
  now-removed deprecated APIs)
- Coverage held at 97.46% lines / 98.50% functions

### Upgrade path

```bash
# In a 5.x project:
npx axiomify migrate --dry-run    # preview every rename
npx axiomify migrate              # apply
npx axiomify check                # validate; exit 1 surfaces what's left
```

For the full guide, see [docs/migration-v4-to-v5.md](./docs/migration-v4-to-v5.md)
— the migrate command applies the same renames that 4.x → 5.x users
went through, with the additional rule that 6.0 also removes
`route.meta`, `RouteMeta`, `routePrefix`, the SQL detector, and
`res.error`.

---

## [5.0.0]

Audit-remediation release. Closes every §16 hard-blocker from the
production review plus the should-fix items. See the section below
for the granular per-package changes.

Originally staged as `5.0.0-rc.1` for soak testing; the 6.0.0-rc.1
deprecation-removal pass landed on top before final promotion.

This is the audit-remediation pass. The previous `5.0.0` entry below was the
feature baseline; everything in this section is correctness / security /
ergonomics fixes on top of it. Recommend tagging as `5.0.0-rc.1` for a 72-hour
soak under hostile traffic before promoting to `5.0.0` stable.

### ⚠️ Breaking changes (beyond the 5.0.0 baseline below)

These two land in 5.0.0 — *not* a future v6 — because the deprecation
warnings have been live through 4.x and the rc cycle gives us a window
to remove them cleanly. Both are mechanical migrations.

- **`SerializerFn` is single-argument only.** The legacy
  `(data, message, statusCode, isError, req) => unknown` positional form
  was deprecated through 4.x with a runtime warning. `makeSerialize()`
  now THROWS at adapter-construction time with a migration message if it
  detects `fn.length > 1`. Migrate:
  ```ts
  // 4.x (removed in 5.0):
  app.setSerializer((data, message, statusCode, isError, req) => ({ data, ok: !isError }));

  // 5.0+:
  app.setSerializer(({ data, message, statusCode, isError, req }) => ({ data, ok: !isError }));
  ```
- **`AppPlugin` type alias removed.** The deprecated 1-arg plugin shape
  is gone from `@axiomify/core`. The runtime still accepts 1-arg
  configurators (JS drops the extra positional silently) — only the
  named type alias is removed. Code using
  `(app) => { ... }` continues to work; only explicit type annotations
  like `const plugin: AppPlugin = ...` need updating to `AppConfigurator`:
  ```ts
  // 4.x (removed in 5.0):
  const myPlugin: AppPlugin = (app) => { /* ... */ };

  // 5.0+:
  const myPlugin: AppConfigurator = (app) => { /* ... */ };
  // …or just drop the annotation entirely; 1-arg fns are inferred.
  ```

- **OpenAPI metadata field renamed: `meta` → `openapi`.**
  The route-level metadata field has been renamed to match OAS 3.0.3
  terminology exactly — its shape mirrors the
  [Operation Object](https://spec.openapis.org/oas/v3.0.3#operation-object)
  verbatim, so authors can paste fragments straight from the spec. The
  type alias `RouteMeta` is renamed to `OpenApiOperation`; the old name
  is kept as a deprecated alias through 5.x.

  Both `openapi` and `meta` work through the 5.x line — the generator
  reads `openapi` first, falls back to `meta`. If both are present,
  `openapi` wins (no merge — merge would produce surprising precedence).
  The `meta` field is removed in 6.0.

  ```ts
  // 4.x
  app.route({ method: 'GET', path: '/u/:id', meta: { tags: ['U'], operationId: 'getU' }, handler });

  // 5.0+
  app.route({ method: 'GET', path: '/u/:id', openapi: { tags: ['U'], operationId: 'getU' }, handler });
  ```

### 📘 OpenAPI — 100% Operation Object coverage

The OpenAPI generator now emits every OAS 3.0.3 Operation Object property.
Five fields were unreachable from a route definition before this pass
(silent gaps for anyone running `openapi-typescript` / `openapi-generator`
against the spec — generated clients lost names, deprecation flags, and
async callback contracts):

- **`operationId`** (OAS §4.7.10.5) — supplied via `openapi.operationId`,
  or synthesised stably from `${method}${path}` when omitted
  (`GET /users/:id` → `getUsersById`). Deterministic across releases.
- **`deprecated`** (OAS §4.7.10.9) — `openapi.deprecated: true`.
- **`externalDocs`** (OAS §4.7.10.4) — `openapi.externalDocs: { url, description? }`.
- **`servers`** (OAS §4.7.10.11) — `openapi.servers` array. Use when a
  single endpoint lives at a different host than the rest of the API.
- **`callbacks`** (OAS §4.7.10.8) — `openapi.callbacks: Record<string, unknown>`.
  Passed through verbatim; authors supply the OAS Callback Object shape.

Plus two Axiomify-specific helpers for the schema-derived sections:
- **`requestBodyDescription`** — overrides the auto-generated requestBody
  description.
- **`responseDescriptions`** — `Record<status, description>` map that
  overrides the generator defaults (`Successful response` / `Response 4xx`).

A latent correctness bug was also fixed in the same pass: the previous
`if (security)` truthiness check happened to work because `[]` is truthy
in JS, but the code was structurally fragile. Replaced with explicit
`if (security !== undefined)` so the OAS §4.7.10.10 semantic (`[]` opts
the route OUT of global security) is unambiguous in the source.

### 🔒 Security

- **`@axiomify/native`**: response header injection guard. `res.header(name, value)`
  now throws on CR / LF / NUL bytes in either argument (CWE-113 / RFC 9110 §5.5).
  uWS does not validate header bytes at the socket layer, so the previous shape
  let `res.header('X-Foo', 'bar\r\nSet-Cookie: pwned=1')` split the response and
  inject arbitrary cookies. **No application code change required** — legitimate
  headers continue to work; only attacker-controlled CRLF rejects.
- **`@axiomify/auth`**: JWT secret strength check is now measured in **bytes**
  (`Buffer.byteLength(secret, 'utf8') >= 32`) rather than characters. A 32-char
  base64 string is 24 bytes / 192 bits — below the 256-bit minimum HS256 requires
  per RFC 7518 §3.2. Apps with under-strength secrets that previously passed will
  now warn (dev) or throw (production).
- **`@axiomify/auth`**: refresh-token rotation re-ordered. The old shape revoked
  the previous `jti` *before* signing and saving the new one — a transient Redis
  failure between revoke and save hard-logged-out the user. New order: sign new
  tokens → `store.save(newJti)` → respond → `store.revoke(oldJti)`. Final-step
  revoke failures are now soft (client already has new credentials).
- **`@axiomify/auth`**: refresh handler distinguishes JWT failures (401) from
  infrastructure failures (503). Previously every error in the handler was
  silently coerced to 401; transient store outages masqueraded as expired tokens.
- **`@axiomify/security`**: removed the regex-based SQL injection detector.
  Bypass vectors were trivial (comment insertion, case variation, encoding) and
  the false-positive rate on legitimate JSON containing the strings `union
  select` / `or 1=1` was high. Use parameterised queries at the DB layer instead.
  Setting `sqlInjectionProtection: true` now warns and no-ops. NoSQL operator
  detector (narrow, reliable) retained but remains opt-in.

### 🛡️ Runtime correctness

- **`@axiomify/native`**: multi-value request headers no longer silently
  collapse. Previously `req.forEach((k, v) => headers[k] = v)` overwrote
  duplicate-name headers — an attacker sending two `Authorization` values could
  influence which one downstream plugins read. The adapter now collects repeated
  headers into `string[]` matching the `AxiomifyRequest.headers` type contract.
- **`@axiomify/native`**: `405 Method Not Allowed` returned for registered
  paths with unregistered methods (RFC 9110 §15.5.6). Previously the global
  `any('/*')` fallback returned a generic 404 for `POST /resource` when only
  `GET /resource` was registered. Per-path catch-alls now respond 405 with
  `Allow: <methods>`. Spec compliance fix; gateways and caches handle the two
  responses differently.
- **`@axiomify/native`**: `gracefulShutdown()` now drains in-flight requests.
  The previous implementation closed the listen socket and immediately ran
  `process.exit(0)`, killing requests mid-response. New shape: close socket →
  `await _waitForDrain()` (with `timeoutMs` cap) → run `onShutdown` → exit. This
  closes a classic double-charge vector — a `POST /charge` mid-flight at SIGTERM
  used to commit the DB write but the response never reached the client; client
  retried; payment processed twice.
- **`@axiomify/native`**: bounded SSE and stream backpressure buffers.
  `_pendingSse` and `stream()`'s `pending` array previously grew without limit
  if the client stopped reading. A slow consumer could OOM the process in
  minutes. Hard caps: 8 MiB for `stream()`, 1 MiB for SSE. Source readable is
  destroyed (or SSE connection closed) when the cap is breached. EventSource
  spec mandates auto-reconnect with `Last-Event-ID`, so well-behaved clients
  recover transparently.
- **`@axiomify/core`**: error payload caches (`CACHED_404` / `CACHED_405` /
  `CACHED_413` / `CACHED_500`) are now per-adapter, not module-level. Multiple
  Axiomify instances in the same process no longer overwrite each other's
  caches with each other's serializers mid-flight.
- **`@axiomify/core`**: `app.setSerializer()` throws when called after adapter
  binding. Previously the cached error envelopes (built at adapter construction)
  used the *old* serializer while live responses used the *new* one, producing
  inconsistent response shapes for the same service.
- **`@axiomify/core`**: `makeSerialize()` rejects async serializers at
  construction time via a synchronous probe. A serializer returning a Promise
  would otherwise `JSON.stringify` to `[object Promise]` and silently corrupt
  every response body.
- **`@axiomify/core`**: `HookManager.run` / `runSafe` snapshot the hook array
  before iteration. A hook that calls `app.addHook(type, ...)` of its own type
  no longer mutates the in-progress iteration — added hooks take effect on
  *the next request*, matching the convention used by Express / Fastify / Koa.
- **`@axiomify/native`**: WebSocket message handler — schema validation was
  silently broken in the previous build. The handler called a non-existent
  `ws.routeHandler` which always threw and was caught as `Invalid message`, and
  the parsed payload was lost to a shadowed `const`. WebSockets with
  `schema.message` are now validated via the compiled `validator.execute`,
  and the parsed object reaches the user's `message` callback.
- **`@axiomify/native`**: `parseBodyBuffer` no longer throws on malformed
  percent-encoding in form bodies. `safeDecodeURIComponent` returns the raw
  bytes on `URIError` rather than crashing the request as a 500.

### ⚡ Performance

- **`@axiomify/rate-limit`**: Redis client argument shape is probed once and
  cached. The previous code tried the redis@4 object form, caught the throw,
  retried in ioredis variadic form — on *every* request. V8 deopts surrounding
  hot paths that throw under normal flow; measurable cost was ~100ms of CPU/s
  at 100k req/s.
- **`@axiomify/native`**: SSE payload construction switched from O(n²)
  string concatenation to `array.join('')`. Noticeable for multi-line `data`
  payloads (e.g. log streaming).
- **`@axiomify/native`**: `simdjson` is now in `optionalDependencies` (not
  `dependencies`). Install failures on musl Alpine / ARM containers / sandboxed
  CI no longer break `npm install`; the adapter falls back to V8 `JSON.parse`
  with no behaviour change.

### 📋 HTTP compliance

- `405 Method Not Allowed` is now returned correctly (see runtime section).
- Multi-value request headers preserved (RFC 9110 §5.3 — see runtime section).

### 🧪 Tests

- **+14 tests** covering all of the above:
  - `packages/native/tests/header-injection.test.ts` (7 cases — CR/LF/NUL in
    name + value, plus negative-control happy paths)
  - `packages/native/tests/query-parser.fuzz.test.ts` (6 property-based fuzz
    invariants via `fast-check`: never-throws, null-prototype, value typing,
    ASCII round-trip, `&`-flood DOS, malformed-percent tolerance)
  - `packages/auth/tests/auth.store.test.ts` — refresh handler 503-on-store-fail
    and "does NOT revoke old token when save fails on new one"
  - `packages/core/tests/serialize.test.ts` — async serializer rejection
- Net: **462 passing**, 28 skipped (uWS-dependent on Node ≥23). Coverage
  97.49% lines / 98.48% functions on the gated packages.

### 📚 Docs

- New section in `docs/packages/native.md` documenting `gracefulShutdown()`,
  `allowUserspaceProxy`, and the explicit warning not to use
  `gracefulShutdown` from `@axiomify/core` against a `NativeAdapter`.
- `docs/production-checklist.md` updated to reflect the unified drain API
  and the Linux-only clustering posture.
- `docs/README.md` index now lists `@axiomify/fingerprint` and
  `@axiomify/security` (previously omitted) and no longer references the
  non-existent `@axiomify/ws` page.

### 🔧 CI

- New `native-integration` job — runs the uWS-backed test suite on Linux +
  Node 22 LTS and **fails CI if fewer than 10 tests pass**. Catches regressions
  where the entire native suite silently `describe.skipIf`s on the production
  target.
- New `example-app` job — `npm install` + `tsc --noEmit` against
  `examples/my-app`. Previously the example had phantom deps
  (`@axiomify/express`, `@axiomify/http`, `@axiomify/ws`) and couldn't install.

### 🧹 Cleanup

- Removed phantom `@axiomify/express|http|ws` deps from `examples/my-app`;
  added the real deps the source imports (`graphql`, `helmet`, `logger`,
  `native`, `auth`).
- All workspace packages now at `5.0.0` (some had drifted to `4.0.0`).
- Hardcoded `JWT_SECRET=so+DlSN8...` removed from example `package.json`
  scripts; replaced with `.env.example` documenting the requirement.
- GraphQL playground SRI hashes were placeholder strings
  (`integrity="sha384-[computed-hash]"`) which made every modern browser
  refuse to execute the scripts. SRI attributes removed; CSP still
  constrains script sources.

---

## [5.0.0-feature-baseline] — 2026-05-07

Pre-audit feature snapshot. The audit work above ([5.0.0]) refines and
hardens what this entry introduced; both ship together as `5.0.0`.

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
