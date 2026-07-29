# @axiomify/static

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

- 79513fb: Security hardening across the framework (remediation of a full security audit), new opt-in safety controls, and documentation reconciled with the implementation.

  ### Breaking changes
  - **cors:** `credentials: true` combined with `origin: true` (reflect-all) now throws at startup, matching the existing `origin: '*'` guard — credentialed CORS requires an explicit origin allowlist. With `origin: true`, a missing or literal `null` Origin is no longer reflected. _Migration: replace `origin: true` with an explicit string/array/RegExp/function allowlist when using credentials._
  - **upload:** uploaded content is now always validated by magic-byte sniffing and **fails closed** on undetectable content; a generic `image/*` accept rule no longer admits `image/svg+xml`. _Migration: list `image/svg+xml` explicitly to accept SVGs, or set `validateContent: false` to opt out for a route that genuinely needs opaque content._
  - **fingerprint:** when `trustProxyHeaders` is enabled, the client IP is now derived from the **right-most** `X-Forwarded-For` entry (closest trusted hop) instead of the client-spoofable left-most value. This changes derived IP/fingerprint values behind a proxy. _Migration: ensure Axiomify sits directly behind a trusted proxy when enabling this._
  - **cli / Studio:** the OTLP receiver endpoints now require the Studio bearer token; the Playground code-execution endpoint is disabled unless `AXIOMIFY_STUDIO_ALLOW_EXEC=true`; and non-loopback `Host` headers are rejected (anti-DNS-rebinding). The instrumented app already sends the token, so telemetry is unaffected.

  ### New features
  - **serverless:** new `ServerlessAdapter` options — `maxBodySize` (default 1 MiB; over-limit requests get `413`) and opt-in `trustProxy` (default `false`); generated request ids now use `crypto.randomUUID()`.
  - **graphql:** new `maxQueryLength` and `maxVariablesLength` options (default 10000) that reject oversized queries/variables before parsing.
  - **vault:** new opt-in `defaultDeny` policy mode plus a one-time warning when secrets are accessed with no policy configured; exports `UNKNOWN_CALLER` / `resolveConfidentCallerModuleName()` for fail-closed caller identification.
  - **logger:** value-shape secret masking — JWTs, `Bearer` tokens, and long hex/base64 blobs in logged payloads are masked (best-effort) in addition to key-name masking.

  ### Fixes
  - **cli / Studio:** fixed a path-traversal in the debugger source endpoint (realpath containment; removed the `node_modules` substring bypass) and added `.env`-write validation against newline/config injection.
  - **jobs:** strip control characters from logged error strings to prevent log forging.
  - **deps:** pin the `uWebSockets.js` git dependency to an immutable commit (`624987739d…`) instead of a mutable tag, and align `@axiomify/ws` to the same revision.
  - **examples:** removed hardcoded JWT/API secrets in favour of required env vars, and stopped tracking example vault files.

### Patch Changes

- Updated dependencies
- Updated dependencies [79513fb]
  - @axiomify/core@7.0.0

## 6.3.3

### Patch Changes

- b9d0c2b: - **@axiomify/core**: Add public, type-safe `.resolve()` API to `Axiomify` class to retrieve registered DI services cleanly.
  - **@axiomify/cli**: Minor robustness fix in Studio API package resolution error handling.
  - **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
  - **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).
  - **@axiomify/jobs**: Introduce a resilient, type-safe distributed queue and Saga transaction workflow coordination engine with background workers and native Studio console integration.
  - **@axiomify/vault**: Introduce a secure environment and configuration vault with envelope encryption, ABAC module policies, standard stream redaction, and git-guard checks.
  - **@axiomify/logger**: Expand configuration options with granular opt-in controls (`includeParams`, `includeQuery`, `includeBody`, `includeResponseHeaders`, `includeState`) and safe `BigInt` log serialization.
  - **@axiomify/native**: Hardened privileged internal APIs (`lockRoutes`, `getRawServer`, `registerShutdownCallback`) via strict `ADAPTER_LOCK_TOKEN` validation, simplified payload size limit rejections, and added a pre-built cached 504 Gateway Timeout response wrapper.
- Updated dependencies [b9d0c2b]
  - @axiomify/core@6.3.3

## 6.3.2

### Patch Changes

- 105da33: - **@axiomify/cli**: Fix missing response body formatting (`[Empty Response Body]`) on status codes `>= 400` in the Request Tester by running the configured response serializer on mock responses.
  - **@axiomify/studio-ui**: Update Request Tester replay execution history to be displayed in descending chronological order (newest first).
- Updated dependencies [105da33]
  - @axiomify/core@6.3.2

## 6.3.1

### Patch Changes

- 2637a16: Fix AJV validation failing with additional properties on default schemas by dynamically adjusting the `additionalProperties` mapping to match Zod's default/strict object semantics.
- Updated dependencies [2637a16]
  - @axiomify/core@6.3.1
