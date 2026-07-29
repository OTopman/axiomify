# @axiomify/testing

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
