# @axiomify/serverless

## 7.1.0

### Minor Changes

- e8bc6ff: Deliver the Axiomify 7.1 feature and release-readiness update across the workspace.

  ### Compatibility and migration notes
  - Drop Node.js 20 support and require an active Node 22 or Node 24 release.
  - Return `UploadedFile[]` when multiple uploads use the same field instead of replacing earlier files; consumers of `req.files[field]` must handle `UploadedFile | UploadedFile[]`.

  ### Features and fixes
  - Add `@axiomify/observability` with incoming W3C trace-context propagation, request-scoped custom timings, and browser-visible `Server-Timing` instrumentation.
  - Add the cache, compression, database, session, and testing packages, including Redis-backed integrations, HTTP cache controls, transaction helpers, signed sessions, request injection, streaming assertions, and cookie-aware test clients.
  - Expand authentication with PBKDF2 API keys, asymmetric RS/ES JWT support, remote JWKS verification, OAuth 2.0/OIDC discovery, and PKCE flows.
  - Extend core with signed and unsigned cookie primitives, group-scoped hooks, deprecation utilities, safer dispatch and validation behavior, and correct defaulted optional-field schema handling.
  - Add native HTTP/2 with ALPN fallback, request timeouts, response/header hardening, RFC 9110 range responses, and cross-process WebSocket room delivery through Redis.
  - Expand the CLI with database manifest commands, OpenAPI 3.1 validation, route snapshots and diffs, SDK generation improvements, richer diagnostics, and substantially smaller packed artifacts.
  - Upgrade Studio with request building and collections, playground intelligence, traffic recording and replay, contracts, profiling, tracing, logs, metrics, jobs, WebSocket tooling, privacy controls, and improved lazy-loaded bundles.
  - Add serverless cookie and SSE parity, streaming cleanup, and correct HEAD/null-body behavior; isolate SDK caches and in-flight GETs by effective headers; report OpenAPI conversion and security-reference warnings; and prevent job workers from exceeding concurrency while acquisitions are pending.
  - Preserve every file submitted to a multi-file upload field, expose repeated files as arrays, and clean partial uploads when request streams abort.
  - Clarify explicit jobs-worker startup and accurately document the Node compatibility requirements of the Fetch-based serverless adapter.
  - Source the Studio report version from the CLI package, render the sidebar badge from the current workspace release instead of stale hard-coded v1 values, and make documentation-link and package-policy validation portable in CI environments without ripgrep.
  - Encode Playground base URLs with JSON string serialization so quotes, backslashes, and control characters cannot produce malformed or injectable generated code.
  - Expand Studio and cross-package regression coverage for traffic profiling, request state and cookies, multipart uploads, streamed and SSE responses, OTLP retention, replay migration, runtime events, privacy controls, lifecycle reloads, OpenAPI fallbacks, SDK cache isolation, and database shutdown behavior.
  - Add starters, recipes, examples, migration guidance, package documentation, API-versioning and contract-testing guides, and community contribution templates; remove tracked Playground scratch files and generated example SDK output that should be recreated on demand.
  - Harden CI, CodeQL, release provenance, dependency policy, package validation, documentation-link checks, package-size limits, supported Node.js 22/24 verification, and strict test coverage gates.
  - Align internal dependency ranges and coordinated Changesets behavior so peer updates remain on the 7.x release line and publish consistently as 7.1.0.
  - Validate Studio's content-hashed production bundle before serving it and return a real asset 404 instead of falling through to HTML with an invalid JavaScript MIME type.

### Patch Changes

- Updated dependencies [e8bc6ff]
  - @axiomify/core@7.1.0

## 7.0.1

### Patch Changes

- af39365: Maintenance & Security Patch: Security audit hardening, header removal options, documentation reconciliation, and framework stability improvements.
- Updated dependencies [af39365]
  - @axiomify/core@7.0.1

## 7.0.0

### Major Changes

- Ten-feature expansion: first-class cookies + group-scoped hooks in core, five new packages (testing, compress, cache, session, db), asymmetric JWT/JWKS/API-key/OAuth auth strategies, cross-process WebSocket rooms, an HTTP/2 adapter, static Range requests, and CLI contract governance.

  ### New packages
  - **@axiomify/testing:** inject-style test client — no sockets, no adapter: `createTestClient(app)`, verb shorthands, production-identical serializer envelopes, cookie/SSE/stream capture, and `expectValidResponse()` for asserting responses against route Zod schemas.
  - **@axiomify/compress:** HTTP response compression on `node:zlib` — brotli/gzip/deflate with q-value negotiation, async compression off the event loop, streaming support, MIME/threshold/`no-transform` guards, and a `disableCompression` escape hatch. 206 responses are never compressed.
  - **@axiomify/cache:** always-on ETag/`If-None-Match` conditional GET plus an opt-in shared response cache with stale-while-revalidate, `cacheControl()`/`noCache` helpers, LRU memory + BYO-client Redis stores, and a DI invalidation API.
  - **@axiomify/session:** signed cookie sessions on core's new cookie layer — Proxy dirty tracking, `destroy()`/`regenerate()`/`touch()`/`save()`, rolling expiry, ≥32-byte secret enforcement with rotation, and Memory/Redis stores behind a `SessionStore` interface.
  - **@axiomify/db:** client-agnostic database integration — `createDatabaseModule()` (sync DI provide, async `ready`), duck-typed Prisma/Drizzle/pg/mysql2/better-sqlite3 support, `withTransaction()`, `dbHealthChecks()`, `dbShutdown()`, and the `axiomify.db.json`/`.mjs` manifest consumed by `axiomify db`.

  ### Core
  - **Cookies:** `req.cookies`, `res.cookie()`/`res.clearCookie()` (multiple `Set-Cookie` lines), `parseCookieHeader`/`serializeCookie` (secure-by-default, injection-hardened), and HMAC-SHA256 `signCookieValue`/`unsignCookieValue` with secret rotation. Implemented across the native, serverless and HTTP/2 adapters.
  - **Encapsulation:** `group.addHook()` — hooks scoped to a route group. `onPreHandler`/`onPostHandler` scope exactly to the group's routes (nested groups included); `onRequest`/`onError`/`onClose` scope by path prefix.
  - **Fix:** request validators now compile Zod schemas with `io: 'input'`, so bodies omitting `.default()` fields are no longer rejected by the AJV fast path.

  ### Extended packages
  - **auth:** RS256/384/512 + ES256/384 JWT via `node:crypto`, `JwksClient` (kid cache, cooldowns, confusion defence), `createApiKeyPlugin` (constant-time, sha256-only storage), and `createOAuthPlugin` (Authorization Code + PKCE, google/github/auth0/OIDC discovery, ID-token verification).
  - **ws:** `WsBroker` interface with `RedisWsBroker` (BYO ioredis/node-redis clients) and `MemoryWsBroker` — rooms, broadcasts and `getGlobalPresence()` now work across `listenClustered()` workers with echo-loop-free forwarding and refcounted subscriptions.
  - **native:** `Http2Adapter` on `node:http2` — ALPN `h2` + `http/1.1` fallback, opt-in `h2c`, full contract parity (cookies, SSE, streaming, graceful GOAWAY shutdown). uWS remains the HTTP/1.1 throughput path.
  - **static:** RFC 9110 single-range requests — `Accept-Ranges`, 206/`Content-Range` streamed slices, 416, `If-Range` validators.
  - **cli:** `routes --snapshot`/`--diff` (byte-deterministic surfaces, breaking-change exit codes for CI), `openapi --validate` (official OAS 3.1 schema + semantic lints), and `axiomify db migrate|seed|generate|status` (manifest-driven, `--dry-run`, ORM detection hints).

### Patch Changes

- Updated dependencies
- Updated dependencies [79513fb]
  - @axiomify/core@7.0.0
