# Changelog


## 6.3.3

### ✨ New Features

#### `@axiomify/core`
- Add public, type-safe `.resolve()` API to `Axiomify` class to retrieve registered DI services cleanly.
- Hardened `lockRoutes()` and `handleMatchedRoute()` internal APIs to enforce strict object identity matching on `ADAPTER_LOCK_TOKEN`, preventing potential caller frame/stack-based security bypasses.
- Integrate request-time environment isolation helper `vaultScope` (re-exported as `ctx.vault.scope` in modules) into standard request dispatcher contexts.

#### `@axiomify/jobs` (New Package)
- Introduce a resilient, type-safe distributed queue and Saga transaction workflow coordination engine with background workers and native Studio console integration.

#### `@axiomify/vault` (New Package)
- Introduce a secure environment and configuration vault with envelope encryption, ABAC module policies, standard stream redaction, and git-guard checks.

#### `@axiomify/logger`
- Expand logger configuration with granular opt-in options: `includeParams`, `includeQuery`, `includeBody`, `includeResponseHeaders`, and `includeState`.
- Add custom fallback serializer for `BigInt` properties to prevent runtime crashes during JSON logging of numeric identifiers.

#### `@axiomify/native`
- Hardened internal APIs (`lockRoutes`, `getRawServer`, `registerShutdownCallback`) via strict `ADAPTER_LOCK_TOKEN` object checks.
- Optimized payload size limit rejection execution path.
- Added a pre-built cached `504 Gateway Timeout` response wrapper for faster timeout responses.

#### Axiomify Studio (`@axiomify/studio-ui`)
- Add **Execution Profiler** (`ProfilerPanel` component) to visual dashboard, rendering interactive flame timeline graphs to debug hook cascades, route durations, and DB queries.

### 🩹 Bug Fixes

#### `@axiomify/cli`
- Minor robustness fix in Studio API package resolution error handling.

### 📝 Documentation
- Align and update core concepts, WebSockets, jobs, vault, and CLI package documentation to reflect recent features (type coercion, sanitize options, cron scheduling, and `vaultScope`).
- Replace `packages/studio-ui/README.md` boilerplate with a real overview.
- Update `MODIFICATION_GUIDE.md` logger update details.

---

## 6.3.2

### 🩹 Bug Fixes

#### `@axiomify/cli`
- Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by executing the application response serializer inside the mock dispatcher.

#### `@axiomify/studio-ui`
- Change Request Tester replay execution history to be sorted in descending chronological order (newest first).
---

## 6.3.1

### 🩹 Bug Fixes

#### `@axiomify/core`
- Fix AJV validation failing with additional properties on default schemas by dynamically adjusting the `additionalProperties` mapping to match Zod's default/strict object semantics.
---

## 6.3.0

### ✨ New Features

#### Axiomify Studio Control Plane
- **Axiomify Studio Server (`@axiomify/cli`)**: Integrated an embedded HTTP/WS control-plane server via `axiomify studio <entry>` to inspect, test, and profile local running applications.
- **Embedded Studio UI (`@axiomify/studio-ui`)**: Created a beautiful, rich developer console featuring:
  - **Analytics Panel**: Unified WebSocket and HTTP traffic metrics with real-time rolling SVG sparkline charts, active connection monitoring, and websocket room statistics.
  - **Interactive SDK Playground**: Write and run TypeScript/Python/Go client SDK test scripts with live autocomplete and dependency resolution.
  - **OpenAPI Analyzer**: Browse, mock-test, and run a quality/conformance audit on API routes.
  - **Error Logs Observatory**: Real-time high-performance log-streaming monitor.
  - **Endpoint Request Tester & Recorder**: Execute HTTP/WS requests and record sequences for automated integration test generation.
* **WebSocket dynamic telemetry**: Added live telemetry instrumentation within `@axiomify/ws` (measuring `messagesReceived` and `messagesSent`) and integrated room presence statistics within `@axiomify/metrics`.

#### `@axiomify/core` — Type Coercion in Validation Pipeline
- **Automatic type coercion for query, params, and body.** Schemas declaring `z.number()` or `z.boolean()` no longer reject valid string representations from the HTTP transport layer. The framework now coerces castable values before validation and only throws `ValidationError` when coercion is impossible.

  Previously, a query parameter like `?limit=5` with schema `z.object({ limit: z.number() })` threw a `ValidationError` because AJV (configured with `coerceTypes: false`) rejected the string `"5"` before Zod could parse it.

  **Coercion rules:**
  - `"5"` → `5`, `"0"` → `0`, `"-10"` → `-10`, `"9.99"` → `9.99` (number/integer schemas)
  - `"true"` → `true`, `"false"` → `false` (boolean schemas)
  - Non-castable values (`"abc"` for a number) are left as-is for proper rejection
  - Nested objects and arrays are coerced recursively
  - `null` / `undefined` values are passed through unchanged

  **Per-source coercion strategy:**
  | Source | Strategy |
  |---|---|
  | `query` / `params` | Pre-coerce → Zod-only validation (AJV bypassed — these are always strings from HTTP) |
  | `body` | Pre-coerce → AJV fast-rejection → Zod parse |
  | `response` | No coercion (handler data, not HTTP input) |

  No code changes required — existing schemas work as-is. Users who already used `z.coerce.number()` as a workaround can optionally simplify to `z.number()`.

### 🔒 Security & Correctness Fixes
* **Static Server Directory Escape (CWE-22)**: Hardened path checks in `@axiomify/static` to prevent relative directory traversal escapes via URL manipulation.
* **Playground VM Escape Mitigation**: Sandboxed code execution in the Studio playground by executing script code in isolated, low-privilege child processes instead of insecure `node:vm` instances.
* **Process Exit Signal Cleanup**: Removed signal listener leaks in `@axiomify/native` by cleanly removing process event listeners on exit/close.
* **Telemetry Discovery Fix**: Fixed a bug in `@axiomify/ws` where WebSocket managers were not visible to telemetry scanners by attaching the room manager reference dynamically to the route definition object.

## 6.2.0
 
### ✨ New Features
 
#### `@axiomify/core` — Route Safety, DI Hardening & Error Masking
 
- **Route conflict detection** (`routeConflict: 'throw' | 'warn'`): parametrized path conflicts are now detected at route registration time. Defaults to `'throw'` — surfacing bugs at startup instead of silently misbehaving at runtime. Pass `'warn'` to restore previous permissive behavior while you resolve conflicts.
- **Strict schema guard** (`strictSchema: boolean`): throws `AxiomifyError` when a typed handler is registered without a Zod schema. Per-route `@axiomify-ignore-schema` inline override supported.
- **`setNotFoundHandler()` / `setMethodNotAllowedHandler()`**: first-class APIs on both `Axiomify` and `NativeAdapter` with full `onRequest` / `onClose` hook lifecycle integration.
- **`forceProvide()`**: test-only escape hatch for overriding sealed DI services without restarting the app instance.
#### `@axiomify/ws` — Room Authorization & Message Sanitization
 
- **`beforeJoin` hook** (`WsRoomOptions.beforeJoin`): async per-join authorization callback. Return `false` or throw to reject with `ROOM_JOIN_FORBIDDEN` (distinct from `JOIN_FAILED` which covers join-limit exhaustion).
- **`allowlist` pattern** (`WsRoomOptions.allowlist`): `RegExp` applied when no `beforeJoin` is registered. Default-deny posture — rooms not matching the pattern are rejected outright.
- **`sanitize` option** (`WsRoomOptions.sanitize`): opt-in sanitization of incoming WebSocket messages for XSS, prototype pollution, and null-byte payloads via `@axiomify/security`. Individually configurable per protection type.
#### `@axiomify/upload` — Automatic Temp-File Cleanup
 
- **`useUpload(app, { autoCleanup: true })`**: registers an `onPostHandler` hook that deletes all temp files written during the request after the handler completes. Prevents disk accumulation on busy servers.
- **`req.cleanup()`**: explicit async cleanup callable from handlers or error hooks. Idempotent — safe to call multiple times.
- **`req.uploadedFiles: string[]`**: typed array tracking all temp paths written in the current request lifecycle.
#### `@axiomify/cli` — AsyncAPI SDK Ingestion
 
- **`axiomify sdk generate`** now accepts AsyncAPI 2.x specs as input. Format is auto-detected by the presence of the `asyncapi` key in the parsed spec — no new flags required. Diff, validate, and migrate sub-commands updated to handle AsyncAPI-sourced IR.
---
 
### 🔒 Security & Correctness Fixes
 
#### `@axiomify/core`
- **DI container sealed after `bootstrap()`**: calling `provide()` post-bootstrap now throws `AxiomifyError`. Duplicate token registration also throws. Both were previously silent data hazards.
- **Production error masking**: non-validation errors in `NODE_ENV=production` are now returned as `{ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }` — DB schema details and stack traces are never sent to clients. `ValidationError` responses retain structured field-level detail.
- **`req.state` immutability**: `RequestStateImpl` enforces write-once semantics via a proxy wrapper. The `user` credential object is frozen on assignment — mutations after auth throw at runtime.
- `RequestDispatcher` now appends `OPTIONS` to the `Allow` header on 405 responses.
- `NativeAdapter` constructor logger assignment order corrected — logger is available before any adapter lifecycle events fire.
#### `@axiomify/auth`
- HS256 secret minimum enforced at 32 bytes (256 bits) per RFC 7518 §3.2, measured as UTF-8 encoded byte length (not character count). Secrets below this threshold throw at plugin registration instead of silently failing at token verification time.
#### `@axiomify/security`
- NoSQL injection pattern set extended with `$elemMatch`, `$slice`, `$pull`, and `$lookup` MongoDB operators.
- `replaceUntilStable()` iteration capped at 10 to prevent O(n²) ReDoS from adversarial nested bypass payloads.
- `prototypePollutionProtection` now documents in JSDoc that `__proto__`, `prototype`, and `constructor` keys are silently stripped from request body, query, and params.
#### `@axiomify/native`
- `trustProxy: true` without a `proxyIpValidator` now emits a startup warning instead of silently trusting all forwarded IPs — prevents IP spoofing via unvalidated `X-Forwarded-For` headers.
#### `@axiomify/ws`
- Client tracking migrated to module-scoped `WeakMap` structures — eliminates `any` casts and prevents state collision between concurrent clients.
- Room auth teardown correctly calls `.close()` — eliminates open-handle warnings in CI.
---
 
### 🏗️ Infrastructure
 
- npm package provenance enabled on all published packages — releases are now signed with OIDC-attested GitHub Actions build provenance.
- ESLint and Prettier configurations codified at repo root.
---

## [6.1.0]

### ✨ New features

#### `@axiomify/ws` — Native pub/sub rooms package

- Wraps native uWebSockets.js topic pub/sub in a clean `RoomManager` and `Room` API.
- Broadcasts to channels in $O(1)$ kernel-space via client `_wsClient.publish()`.
- Supports schema-less endpoints by parsing raw Buffer/string payloads inside `_processAction`.

#### Enterprise Type-Safe SDK Generation Platform

- **`axiomify sdk generate`**: Generate fully-typed multi-language SDKs (`TypeScript`, `Python`, `Go`, `Swift`, `Kotlin`, `Dart`) from your backend, OpenAPI specs, or GraphQL schemas using the `TypeGraph` AST compiler.
- **`axiomify sdk diff` / `validate`**: Compare schemas in CI/CD pipelines to prevent breaking API changes, and perform strict syntactic/semantic validation.
- **Live Watch Mode**: Automatically regenerate SDKs on the fly during development using `axiomify dev --watch-sdk <langs...>`.
- **`@axiomify/sdk-runtime`**: Zero-dependency fetch-based runtime supporting client-side retries, interceptors, circuit breakers, caching, and offline queueing.

### 🔒 Correctness, performance & security fixes

- **WS Room Presence:** Added a membership check to the Room presence endpoint to prevent unauthorized information leakage of channel participants.
- **Core/Native:** Properly propagated WebSocket configuration settings (`compression`, `maxPayloadLength`, and `idleTimeout`) directly to the uWebSockets.js C++ layer.
- **Core/Security:** Integrated an `isPlainObject` validator to prevent object sanitizers from corrupting/mutating `Date` and `Buffer` instances.
- **Auth:** Optimized the `MemoryTokenStore` to prune expired tokens using a single process-wide `setInterval` loop instead of thousands of individual `setTimeout` timers.
- **CORS:** Safely resolved the `credentials: true` and `origin: true` combination by reflecting the request origin dynamically.
- **Security:** Guarded the NoSQL operator regex detector from Stack Overflow DoS using a recursion depth limit (max 64) and plain object filtering.
- **Native:** Restored `uWebSockets.js` in `optionalDependencies` of `@axiomify/native` to prevent downstream dependency resolution issues.

### Tests

625 passing across 58 files · Coverage: 97.49% lines / 98.48% functions on gated packages.

---

## [6.0.0]

> **Upgrading from v5?** See [docs/migration-v5-to-v6.md](docs/migration-v5-to-v6.md)
> and run `npx axiomify migrate` to apply renames automatically.

### ⚠️ Breaking changes

#### Adapters removed — `@axiomify/native` is the only adapter

| Removed             | Replacement                              |
| ------------------- | ---------------------------------------- |
| `@axiomify/express` | `@axiomify/native`                       |
| `@axiomify/fastify` | `@axiomify/native`                       |
| `@axiomify/hapi`    | `@axiomify/native`                       |
| `@axiomify/http`    | `@axiomify/native`                       |
| `@axiomify/ws`      | `app.ws()` built into `@axiomify/native` |

#### `route.meta` removed — metadata merged into `schema`

v5's `meta: RouteMeta` field (4 fields: `tags`, `summary`, `description`, `security`)
is removed. All metadata now lives in `schema:` alongside Zod validation fields.
v6 expands coverage to the full OAS 3.1.0 Operation Object (11 fields total).

```ts
// v5.0.0
app.route({
  schema: { body: CreateUserSchema },
  meta: { tags: ['Users'], summary: 'Create user' },
  handler,
});

// v6.0.0
app.route({
  schema: {
    body: CreateUserSchema,
    tags: ['Users'],
    summary: 'Create user',
    operationId: 'createUser',
  },
  handler,
});
```

#### `RouteMeta` type removed — use `RouteSchema` or drop the annotation

#### OpenAPI spec upgraded 3.0.3 → 3.1.0 (JSON Schema 2020-12)

Optional fields use `type: ["string","null"]` instead of `nullable: true`.

#### `useOpenAPI({ routePrefix })` removed — use `prefix:`

#### `useSecurity({ sqlInjectionProtection })` removed — use parameterised queries

Exports `DEFAULT_SQL_PATTERNS` and `detectSqlInjection` also removed.

#### `AxiomifyResponse.error()` removed — use `res.status(code).send(null, msg)`

#### `SerializerFn` 5-arg positional form now throws (warned in v5)

#### `AppPlugin` type removed — use `AppConfigurator`

#### `@axiomify/auth` — weak-secret check uses `Buffer.byteLength` (RFC 7518 §3.2)

#### `@axiomify/logger` — `maskify-ts` removed; PII masking is now built-in

---

### ✨ New features

#### `@axiomify/socket.io` — Socket.IO 4.x bridge on the same uWS server

```ts
import { attachSocketIO, adaptAxiomifyPlugin } from '@axiomify/socket.io';
const io = await attachSocketIO(adapter, {
  cors: { origin: 'https://app.example.com' },
});
io.use(adaptAxiomifyPlugin(requireAuth));
io.on('connection', (socket) => socket.emit('welcome', {}));
```

#### Native WebSocket routes — `app.ws()` built into `@axiomify/native`

#### Full OAS 3.1.0 Operation Object in `schema` — 7 new fields vs v5

`operationId`, `deprecated`, `externalDocs`, `servers`, `callbacks`,
`requestBodyDescription`, `responseDescriptions`

#### DI `resolve()` throws on unregistered tokens (was silent `undefined` in v5)

#### `@axiomify/native` — simdjson acceleration, SSE (`res.sse()`), multi-value query params

---

### Tests

524 passing across 50 files · Coverage: 97.46% lines / 98.50% functions

### Publish notes (rc.1 → rc.3)

rc.1–rc.3 were version alignment bumps from partial npm publish failures.
rc.3 adds `repository`, `homepage`, `bugs`, `license`, `author`, per-package
descriptions, and absolute URLs in package READMEs for npmjs.com rendering.

## [6.0.0-rc.*]

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

These two land in 5.0.0 — _not_ a future v6 — because the deprecation
warnings have been live through 4.x and the rc cycle gives us a window
to remove them cleanly. Both are mechanical migrations.

- **`SerializerFn` is single-argument only.** The legacy
  `(data, message, statusCode, isError, req) => unknown` positional form
  was deprecated through 4.x with a runtime warning. `makeSerialize()`
  now THROWS at adapter-construction time with a migration message if it
  detects `fn.length > 1`. Migrate:

  ```ts
  // 4.x (removed in 5.0):
  app.setSerializer((data, message, statusCode, isError, req) => ({
    data,
    ok: !isError,
  }));

  // 5.0+:
  app.setSerializer(({ data, message, statusCode, isError, req }) => ({
    data,
    ok: !isError,
  }));
  ```

- **`AppPlugin` type alias removed.** The deprecated 1-arg plugin shape
  is gone from `@axiomify/core`. The runtime still accepts 1-arg
  configurators (JS drops the extra positional silently) — only the
  named type alias is removed. Code using
  `(app) => { ... }` continues to work; only explicit type annotations
  like `const plugin: AppPlugin = ...` need updating to `AppConfigurator`:

  ```ts
  // 4.x (removed in 5.0):
  const myPlugin: AppPlugin = (app) => {
    /* ... */
  };

  // 5.0+:
  const myPlugin: AppConfigurator = (app) => {
    /* ... */
  };
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
  app.route({
    method: 'GET',
    path: '/u/:id',
    meta: { tags: ['U'], operationId: 'getU' },
    handler,
  });

  // 5.0+
  app.route({
    method: 'GET',
    path: '/u/:id',
    openapi: { tags: ['U'], operationId: 'getU' },
    handler,
  });
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
  the previous `jti` _before_ signing and saving the new one — a transient Redis
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
  used the _old_ serializer while live responses used the _new_ one, producing
  inconsistent response shapes for the same service.
- **`@axiomify/core`**: `makeSerialize()` rejects async serializers at
  construction time via a synchronous probe. A serializer returning a Promise
  would otherwise `JSON.stringify` to `[object Promise]` and silently corrupt
  every response body.
- **`@axiomify/core`**: `HookManager.run` / `runSafe` snapshot the hook array
  before iteration. A hook that calls `app.addHook(type, ...)` of its own type
  no longer mutates the in-progress iteration — added hooks take effect on
  _the next request_, matching the convention used by Express / Fastify / Koa.
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
  retried in ioredis variadic form — on _every_ request. V8 deopts surrounding
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

## [5.0.0] — 2026-05-07

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

| Adapter             |     1w |     2w |  Scaling |
| ------------------- | -----: | -----: | -------: |
| `@axiomify/http`    | 35,800 | 57,200 | **160%** |
| `@axiomify/fastify` | 21,300 | 35,200 | **165%** |
| Native (uWS)        | 85,000 | 91,300 |    107%† |

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

| Export               | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `ADAPTER_LOCK_TOKEN` | `unique symbol` for `lockRoutes()` / `handleMatchedRoute()` |
| `AdapterLockToken`   | TypeScript type of the token                                |
| `AxiomifyLogger`     | `{ warn, error }` injectable logger interface               |
| `defaultLogger`      | `console`-backed default implementation                     |

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
