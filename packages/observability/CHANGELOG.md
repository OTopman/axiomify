# @axiomify/observability

## 7.2.0

### Minor Changes

- dd7faa4: Deliver the Axiomify 7.2 release featuring Studio script IntelliSense, pre-request execution sandbox, collection batch runner, and full mobile responsiveness.

  ### Studio UI enhancements
  - **Script Sandbox & IntelliSense**: Pre-request and test script execution in a secure sandbox with infinite loop timeout guards, and autocompletion for `$` and `axiomify` APIs.
  - **Dedicated Pre-Request Timeline**: Dedicated output inspection pane displaying execution duration, console logs, and real-time mutated headers/params/env variables.
  - **Environment Variables IntelliSense**: Interactive `{{variable}}` autocomplete popup across URL, header, and parameter inputs with live substitution previews.
  - **Collection Batch Runner**: Modal runner to execute all requests in a collection folder sequentially with progress tracking, assertion pass/fail summaries, and latency timelines.
  - **Sidebar Collapsed Tooltips**: Accessible floating tooltip badges displaying route categories and navigation labels on mouse hover and keyboard focus.
  - **Full Mobile Responsiveness**: Off-canvas slide-out navigation drawer with backdrop overlay for screens `<= 768px`, compact 32×32px header search trigger, 3-pane mobile segmented control (`Routes | Request | Response`) for Request Tester and WebSocket Tester (`Routes | Composer | Traffic`), and touch-scrolling data tables.

  ### Framework & Runtime updates
  - **Core Route Groups**: Inherit and thread scoped middleware/plugins onto nested WebSocket route definitions (`group.ws(...)`).
  - **CLI & Studio Server**: Support Next.js content-hashed bundles (`/_next/`), font MIME types (`.woff2`, `.woff`, `.ttf`), and strict 404s for missing chunks.
  - **SDK Runtime**: Exposed `BaseClient.prototype.request` as public to facilitate custom client extensions and contract testing without network binding.

  ### Documentation & Starters
  - Added recipes for **Tenant-Scoped Routes** and **Webhook Signature Validation**.
  - Added standalone **Serverless API Starter** (`starters/serverless-api/`) for Fetch/WinterCG runtimes.
  - Added contract testing guidelines for generated SDK integration testing with `@axiomify/testing`.

### Patch Changes

- Updated dependencies [dd7faa4]
  - @axiomify/core@7.2.0

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
