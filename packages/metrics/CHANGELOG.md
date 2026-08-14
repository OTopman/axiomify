# @axiomify/metrics

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

- Updated dependencies [af39365]
  - @axiomify/core@7.0.1

## 7.0.0

### Major Changes

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
