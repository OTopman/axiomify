# Changelog

## [4.2.0] — 2026-05-03

### 🚨 Bug Fixes

#### No double routing — all adapters
Every adapter previously called Axiomify's router twice (or more) per request:
- **Express**: body-parser middleware + Express router + catch-all → 3 lookups. Fixed: body parsers registered globally, Express router used for all routing, Axiomify router only in 404/405 fallback.
- **Fastify**: `all('/*')` catch-all bypassed Fastify's C++ radix trie entirely. Fixed: per-route `app.get()` / `app.post()` registration. Also fixed Fastify v5 rejecting `DELETE` requests with `Content-Type: application/json` and no body.
- **Hapi**: `method: '*'` catch-all same bypass. Fixed: per-route registration with `:param` → `{param}` path conversion at startup.
- **Native**: `server.any('/*')` catch-all — uWS C++ router never used. Fixed: per-route `server.get()`, `server.post()`, `server.del()` etc. uWS resolves route in native code before any JS runs.
- **HTTP**: was calling `core.handle()` (which calls the router) instead of `core.handleMatchedRoute()`. Fixed.

#### `@axiomify/http` — body/query/params getters prevented Zod transform writes
`translateRequest()` exposed `body`, `query`, `params` as read-only getters. `ValidationCompiler` assigns post-transform values back onto the request, causing `TypeError: Cannot set property body`. Fixed: writable properties.

#### `@axiomify/openapi` — Zod v4 produced empty schemas
`zod-to-json-schema` v3.x returns `{}` for all Zod v4 schemas. Fixed: uses `z.toJSONSchema()` (Zod v4 built-in, emits JSON Schema 2020-12).

#### `@axiomify/security` — `Object.defineProperty` degraded V8 performance
Replacing `req.body` etc. via `Object.defineProperty` switches the object from V8 fast-path (hidden class) to dictionary mode. All subsequent property accesses on the request object become slower. Fixed: direct assignment.

#### `@axiomify/auth` — weak JTI validation with revocation store
When `store` is configured, tokens without a `jti` claim were not rejected. Fixed.

#### `@axiomify/rate-limit` — EVALSHA fallback called `evalsha()` twice on NOSCRIPT
When `evalsha()` threw `NOSCRIPT`, the catch block tried the redis@4 object-style API — which called `evalsha()` again. The second call succeeded (NOSCRIPT clears the flag) without ever calling `eval()`. Fixed: propagate `NOSCRIPT` without retrying as a style mismatch.

#### `@axiomify/graphql` — `require('../src')` in tests
Tests used `require('../src')` (a CJS require of TypeScript source). Fixed: `require('../dist/index.js')`.

#### `@axiomify/logger` — `maskify-ts` hard `reflect-metadata` dependency
Removed `maskify-ts` import; inline `fallbackMaskObject` already handled all masking use cases.

#### `@axiomify/core` — Zod v4 body-missing error message changed
Zod v4 emits `'Invalid input: expected object, received undefined'` instead of `'Required'`. Fixed: detect both patterns.

#### `@axiomify/native` — `bridge.ts` `getHeader` returned `undefined` always
Fixed: delegates to `res.getHeader(name)`.

#### `@axiomify/native` — `isError` hardcoded `false` in `send()`
Fixed: `statusCode >= 400`.

#### `@axiomify/native` — `stream()` missing `contentType` parameter
Fixed: signature `stream(readable, contentType = 'application/octet-stream')`.

---

### ⚡ Performance

#### AJV-compiled validation (all adapters)
Zod schemas converted to JSON Schema 2020-12 via `z.toJSONSchema()` at startup, compiled with `ajv/dist/2020`. Runtime cost: ~0.06µs valid path (was ~0.30µs with Zod safeParse), ~0.12µs invalid path (was ~49.75µs — **428× faster**). Zod `.parse()` runs after AJV on the valid path to apply transforms.

#### Core pipeline — 5 async/await eliminations
- Removed `attachRequestSignal` — was allocating `AbortController` + `addEventListener` per request even with `timeout=0`
- `onPreHandler` step only compiled into route pipeline when handlers actually exist
- `HookManager.run()` returns synchronously for empty lists; calls single handlers directly (no async wrapper)
- `runSafe` early-exits on empty hook list
- Registry handler step: direct `handler(req, res)` call when `timeout=0` and no telemetry — no `async` wrapper

#### Native adapter — additional per-request savings
- `TextDecoder` reuse for IP extraction (saves ~0.079µs vs `Buffer.from().toString()`)
- Atomic counter for X-Request-Id (0.049µs vs `randomUUID()` 0.137µs)
- Pre-serialised 404/405/413/500 error bodies — zero `JSON.stringify` in error path
- Status line cache — Map lookup per response instead of string template
- Named param extraction via `req.getParameter(i)` indexed by position (pre-computed at startup)

#### Router rewrite
- Character-by-character URL walking — no `split('/').filter(Boolean)` allocation per lookup
- Pre-allocated flat param accumulator passed through recursion — no `[...spread]` per matched param
- Output `Record<string, string>` built exactly once at the end

#### Benchmark results (autocannon · 100c · p10 · 12s · Node 22 · single process)

| Server | Before | After | Delta |
|---|---:|---:|---:|
| Axiomify Native GET /ping | 20,091 | **50,493** | +151% |
| Axiomify Native POST /echo | 19,151 | **37,672** | +97% |
| Axiomify + Fastify | 7,550 | **10,487** | +39% |
| Axiomify + HTTP | 8,088 | **9,965** | +23% |

4-core projections (90% efficiency): Native ~182k req/s, Fastify ~38k req/s, HTTP ~36k req/s.

---

### ✨ New Features

#### `listenClustered()` — all adapters
All adapters now expose `listenClustered()`:
- **Native**: uses `SO_REUSEPORT` — kernel distributes connections, zero IPC overhead
- **Express, Fastify, Hapi, HTTP**: uses Node.js cluster with automatic worker restart

#### `@axiomify/auth` — access token revocation via `store`
`createAuthPlugin` now accepts `store?: TokenStore`. When set, `store.exists(jti)` is called on every authenticated request. Tokens without `jti` claim are rejected. Enables immediate logout without waiting for expiry.

#### `@axiomify/rate-limit` — EVALSHA caching + dual-client support
`RedisStore` now sends `EVALSHA` after the first `EVAL` — only a 40-byte SHA1 per call instead of the full Lua script. Falls back to `EVAL` on `NOSCRIPT`. Supports both `ioredis` variadic API and `redis@4` object API.

#### `@axiomify/ws` — `getServerFromAdapter()` helper
Extract the underlying `http.Server` from any adapter (Express, Fastify, Hapi, HTTP) without accessing internal fields.

#### `@axiomify/static` — configurable cache control + extended MIME table
`cacheControl` option — configurable per-route (`'no-store'`, `'public, max-age=31536000, immutable'`, etc.). `serveIndex` option for SPA index.html fallback. MIME table extended from 10 to 36 types (webp, avif, wasm, woff, csv, yaml, pdf, mp3, etc.).

#### `@axiomify/native` — built-in WebSocket support
`NativeAdapter` accepts a `ws` option — registers a WebSocket endpoint directly with uWS C++ WebSocket handling. No need for `@axiomify/ws` on the native adapter.

#### `@axiomify/native` — SSE guard
Throws at startup if any route uses `res.sseInit()` or `res.sseSend()` — SSE is not supported by uWS; this prevents silent failures.

#### `@axiomify/native` — HEAD auto-registration
Every GET route automatically gets a HEAD handler. uWS doesn't auto-create HEAD for GET.

---

### 🧪 Tests

306 tests across 34 files (0 failures). New tests added:
- **Cross-adapter parity** (`describe.each` across all 4 HTTP adapters): 48 tests covering routing, param extraction, 404/405, validation, body rejection, X-Request-Id, prototype pollution, query strings
- Access token revocation (auth)
- EVALSHA caching (rate-limit)
- Zod v4 OpenAPI schema generation (openapi)
- No-double-routing proof (http)
- Configurable cache control + 10 MIME types (static)
- CORS preflight response (cors)
- Upload hook plumbing (upload)

---

### 📚 Documentation
Full rewrite of all 20 package READMEs, `core-concepts.md`, `adapters.md`, `production-checklist.md`, and all `docs/packages/*.md` files to reflect the current API.

---

## [4.1.0] — 2026-04-21

### ✨ New Packages

- **`@axiomify/graphql`** — GraphQL endpoint with GraphiQL 3, depth/alias limits, per-request context

### 🔒 Security Fixes (from senior architect review)
- Proxy-aware `req.ip` handling
- `AbortController`-backed timeout cancellation
- Graceful shutdown draining keep-alive connections
- Multi-value query parameter preservation
- Resilient `onError` hook chains via `HookManager.runSafe()`
- Hard-throwing weak JWT secret validation

---

## [4.0.0] — 2026-03-15

Initial public release of the Axiomify monorepo with core, adapters, and plugin packages.
