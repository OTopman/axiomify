# Changelog

## [4.0.0] - 2026-04-20

### ⚠️ BREAKING CHANGES

**If you're upgrading from v3.1.x, read these carefully.**

- **CORS Configuration**: `useCors({ credentials: true, origin: '*' })` now **throws at startup** instead of silently violating the CORS spec. Either use a specific origin list or omit `credentials: true`. This prevents browser-rejected responses that would fail at runtime anyway.
- **WebSocket Function Signature**: `useWebSockets(app, options)` now requires both arguments explicitly (previously accepted single `options` and extracted `app` implicitly). Update call sites:
  ```ts
  // Before
  useWebSockets({ server: wss });
  
  // After
  useWebSockets(app, { server: wss });
  ```
- **File Upload Strictness**: Filenames containing path traversal sequences (`../`, absolute paths, null bytes) are now **rejected outright** rather than silently sanitized. Users who relied on lenient handling will see `400 Bad Request`. This is intentional — unsafe names indicate either a misconfigured client or an attack. Handle normalization at the application layer before upload.
- **HTTP Adapter**: The top-level error handler now honors `err.statusCode` from all upstream sources (including adapters). If your code was throwing bare `new Error()` and expecting a `500`, you'll now see `500`. If you were throwing custom objects with `.statusCode`, behavior is unchanged.

### ✨ Features

#### New Packages (7 total)

- **`@axiomify/auth`** — JWT-based authentication with `useAuth` plugin, automatic `req.user` population, and `createRefreshHandler` for secure token rotation. Enforces RFC 6750 (case-insensitive Bearer scheme) and minimum secret entropy checks.
  
- **`@axiomify/cors`** — Framework-agnostic CORS middleware with automatic `OPTIONS` preflight, proper `Vary: Origin` headers, and strict validation of dangerous configurations. Replaces ad-hoc CORS logic.
  
- **`@axiomify/helmet`** — Configurable HTTP security headers (HSTS, CSP, X-Frame-Options, etc.) via `useHelmet`. Zero breaking surface.
  
- **`@axiomify/metrics`** — Prometheus-compatible observability exporting request latency, status codes, and per-route cardinality. Includes a live HTML dashboard at `/metrics/dashboard`. Query patterns (not URLs) to prevent cardinality explosion.
  
- **`@axiomify/rate-limit`** — Sliding-window rate limiting with in-memory or Redis backing. Supports per-route enforcement, custom key extraction, and distributed clustering via RedisStore.
  
- **`@axiomify/static`** — Secure static file serving with directory traversal protection, streaming responses, and conditional 304 Not Modified for `ETag`/`If-None-Match`.
  
- **`@axiomify/ws`** — Schema-first WebSocket management with Zod validation, automatic message routing, room/broadcast support, and per-client heartbeat. Binary frame routing via `onBinary` callback.

#### Core Engine

- **Health Checks**: New `app.healthCheck(path?, checks?)` method for distributed readiness checks. Executes all checks in parallel, returns `200 OK` if all pass, `503 Service Unavailable` with partial results if any fail.
  
- **Graceful Shutdown**: Built-in `app.gracefulShutdown(timeoutMs)` utility to drain pending requests on SIGTERM/SIGINT. Includes force-exit countdown timer and prevents orphaned connections.
  
- **OpenTelemetry Integration**: Hooks now receive `RequestState` with `startTime` (BigInt) for precise span generation. Use `(Date.now() - Number(startTime / 1000n))` to compute duration in native timing contexts.
  
- **Streaming API**: All adapters (Express, Fastify, Hapi, HTTP) now support `res.stream(readable)`, `res.sseInit()`, and `res.sseSend(data, event?)` for Server-Sent Events.
  
- **Plugin System**: Route-level plugins are now the standard for middleware. Plugins execute before schema validation, have access to `req`, `res`, and can short-circuit via `res.headersSent = true`.

#### Security Hardening

- **Prototype Pollution Prevention**: All HTTP adapters (Fastify, Hapi, Express, HTTP) now sanitize parsed JSON bodies to strip `__proto__`, `constructor`, and `prototype` keys. Protects against malicious payloads attempting `Object.prototype` mutation.
  
- **Path Traversal Defense**: Upload and Static packages now use `path.resolve() + startsWith()` containment checks. Filenames with `..`, absolute paths, or null bytes are rejected immediately.
  
- **CORS Spec Compliance**: Fixed origin reflection bypass. CORS now:
  - Validates that `credentials: true` is never paired with `origin: '*'`
  - Emits `Vary: Origin` for non-wildcard origins (critical for CDN caching)
  - Properly rejects disallowed origins
  
- **JWT Algorithm Pinning**: Auth plugin enforces a single JWT algorithm (defaults to HS256) and warns if the secret is shorter than 32 characters.

#### Adapter-Specific Fixes

- **Fastify**:
  - Fixed wildcard route syntax from `/{*}` (invalid in Fastify v5) to `/*`
  - Added prototype pollution sanitization on request bodies
  - Regression tests added for both issues
  
- **Hapi**:
  - Fixed request body parsing to read `req.payload` stream instead of exposing raw stream to handlers
  - Added prototype pollution sanitization
  - Regression tests added
  
- **HTTP (Native Node.js)**:
  - Fixed multibyte UTF-8 corruption in streaming reads (was concatenating `Buffer` + `string`)
  - Now uses `Buffer.concat()` accumulator with explicit `utf8` decoding
  - Fixed top-level error handler to honor `err.statusCode` instead of hard-coding 500
  - Added `sendRaw(body, contentType)` for edge cases (e.g., 304 Not Modified without Content-Type)

#### Type Safety

- **`AxiomifyRequest` Generics**: Now default `Params` to `Record<string, string>` instead of `any`. Fully eliminates implicit `any` in route handlers.
  
- **`RequestState` Enrichment**: Added `startTime: BigInt` for high-resolution duration tracking without depending on external logger state.
  
- **Response Validation**: Strict per-status response schema checking now active in development (throws), warnings in production. Prevents returning wrong payload shapes.

#### Developer Experience

- **Route-Level Timeouts**: Per-route `timeout: ms` setting (global + route override). Triggers `503 Service Unavailable` if handler doesn't resolve in time.
  
- **Wildcard Routes**: Fallback routes with `path: '*'` or `path: '/*'` for custom 404 handling and static proxying.
  
- **Health Dashboard**: Metrics package includes live `/metrics/dashboard` HTML page with latency histograms and request rates.
  
- **Improved Test Coverage**: New comprehensive test suites for all seven new packages. Total coverage: 83.6% statements, 80.7% branches, 84.9% functions (note: excludes pure type files and untestable adapter code).

### 🐛 Bug Fixes

- **Rate Limiting**:
  - Fixed `MemoryStore.resetTime` calculation (was always "now", should be window start + windowMs)
  - Fixed `createRateLimitPlugin` / `useRateLimit` duplicate enforcement
  
- **Core Router**:
  - Fixed indentation/logging (was using 1-space indent, now uses 2)
  - Fixed route deduplication (indexOf was returning first match globally, not current index)
  
- **Core Validation**:
  - Fixed `required` array logic (had `|| true` making left side dead code)
  - Removed reliance on Zod internals (`._def`); now uses `typeof value.safeParse === 'function'` duck-typing
  
- **Core App**:
  - Fixed `validateResponse` to pass actual `res.statusCode` instead of defaulting to 200
  - Fixed `onPostHandler` to fire even on plugin short-circuits
  - Fixed response validation bypass on thrown-handler path (now guarded by `responseSent` flag)
  
- **Fastify Adapter**:
  - Fixed `sendRaw` to actually set `isSent = true` (headers-sent checks were lying)
  
- **Hapi Adapter**:
  - Fixed request body to be parsed JSON, not raw stream
  
- **OpenAPI Generator**:
  - Fixed `required` array emission (was always false when it should respect schema)
  - Fixed `routePrefix` undefined fallback (routes were appearing at `undefined/openapi.json`)
  
- **Core Shutdown**:
  - Fixed force-exit timer not clearing on clean shutdown
  - Fixed stacked `process.on` listeners (now uses `once`)
  
- **Upload Plugin**:
  - Fixed multibyte filename handling during sanitization
  - Fixed detection of path traversal in edge cases (now resolves both root and file path)
  
- **HTTP Adapter**:
  - Fixed multibyte UTF-8 corruption in body streaming
  - Fixed 304 Not Modified to use raw response instead of sending `Content-Type: text/plain`
  
- **Logger Plugin**:
  - Fixed hook execution order to guarantee `startTime` is always present
  - Now computes duration from internal `startTime` instead of relying on external sources
  
- **Metrics Plugin**:
  - Fixed cardinality explosion by using route *patterns* (e.g., `/users/:id`) instead of concrete URLs
  - Fixed `durationMs` calculation to not depend on logger plugin being present first
  
- **WebSocket**:
  - Fixed binary frame handling (was feeding to JSON.parse, now routes to optional `onBinary` handler)
  - Added schema validation for text messages

### 📦 Dependency Updates

- Upgraded to TypeScript 6.0+ for improved type inference
- Updated Node type definitions to match v25.x (LTS)
- Locked glob to `>=11.0.0` to address published vulnerabilities in 10.x
- Fastify examples now use v5 syntax
- Express examples bumped to v5

### 🧪 Test Coverage

- Added 44 new tests across 6 test suites (auth, core/app, core/errors, cors, http, ws)
- Total test suite: 119 tests across 26 files, all passing
- Coverage metrics:
  - **Statements**: 83.6% (threshold: 80%)
  - **Branches**: 80.7% (threshold: 80%)
  - **Functions**: 84.9% (threshold: 80%)
  - **Lines**: 83.6% (threshold: 80%)

### 📄 Documentation

- Completely rewritten README with detailed ecosystem descriptions for all 16 packages
- Added per-package READMEs for all seven new packages (auth, cors, helmet, metrics, rate-limit, static, ws)
- Updated all code examples to reflect v4.0.0 APIs
- GitHub workflows enhanced for CI/CD reliability

### 🔄 Migration Guide: v3.1.0 → v4.0.0

**Update CORS calls:**
```ts
// ❌ Before (now throws)
useCors(app, { credentials: true, origin: '*' });

// ✅ After
useCors(app, { credentials: true, origin: ['https://trusted.example'] });
// or
useCors(app, { origin: '*' }); // (no credentials)
```

**Update WebSocket initialization:**
```ts
// ❌ Before
useWebSockets({ server: wss });

// ✅ After
useWebSockets(app, { server: wss });
```

**Upload filename handling — nothing needed if using defaults:**
```ts
// If your app already had custom rename logic, verify it doesn't return unsafe names.
// Axiomify now rejects: "../../../etc/passwd", "/etc/passwd", "\x00", etc.
// If you need that behavior, implement at app layer before calling upload.
```

**No changes needed for:**
- HTTP response status code handling (automatic)
- Route plugin registration (backward compatible)
- Schema validation (automatic enforcement, already strict in v3.1.0 for development mode)

---

## [3.1.0]

### ✨ Features
- **Core**: Introduced a route-level plugin system allowing targeted middleware execution on specific routes prior to schema validation.
- **Feature**: Added wildcard route segment support (`*`) for fallbacks, static proxying, and catch-all 404 handlers.
- **Feature**: Introduced global and per-route request timeouts (`timeout: ms`) to safely bound connection lifespan and automatically dispatch `503 Service Unavailable`.
- **Bug Fix**: Added missing `@axiomify/core` to `@axiomify/upload` dependencies.

### 🐛 Bug Fixes
- **Core**: Enforced strict generics on `addHook()` handlers to prevent silent lifecycle failures and eliminate escaping `any` types.
- **Core**: Activated response validation (`schema.response`) to strictly enforce outgoing payload shapes (throws in development, warns in production).
- **Logger**: Re-engineered payload interception to correctly log outgoing responses and accurately calculate request `durationMs` via `process.hrtime.bigint()`.
- **Hapi Adapter**: Disabled default payload parsing and forced native streams to restore `@axiomify/upload` compatibility.
- **Upload**: Hardened the busboy streaming pipeline against unhandled promise rejections and race conditions during stream failures.
- **CLI**: Standardized dynamic `externals` resolution across `build`, `dev`, and `routes` commands to prevent bundling external server adapters.
- **OpenAPI**: Removed dead legacy generator code and safely handled optional schema objects.
- **Docs**: Corrected the Radix Tree routing time complexity claim from O(1) to a factual O(k, where k = path depth).

## [3.0.0]

### ✨ Features
- **Feature**: Added structured logging package (`@axiomify/logger`) with PII masking via `maskify-ts`.
- **Feature**: Added fully-functional Hapi adapter (`@axiomify/hapi`).
- **Security**: Hardened file upload plugin (`@axiomify/upload`) to stream directly to disk, bypassing RAM entirely. Included unhandled rejection safety buffers.
- **Feature**: Added OpenAPI generator (`@axiomify/openapi`) deriving Swagger docs directly from route schemas.

## [2.0.0]

### ✨ Features
- **Core Optimization**: Introduced custom Radix Tree Router reducing path resolution to O(k).
- **Validation**: Added ahead-of-time Zod compiler.
- **Adapters**: Built adapter abstraction with Express and Fastify support.
