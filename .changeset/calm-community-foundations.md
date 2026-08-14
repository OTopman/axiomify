---
'@axiomify/core': minor
'@axiomify/auth': minor
'@axiomify/native': minor
'@axiomify/serverless': minor
'@axiomify/static': minor
'@axiomify/ws': minor
'@axiomify/cli': minor
'@axiomify/cache': minor
'@axiomify/compress': minor
'@axiomify/db': minor
'@axiomify/session': minor
'@axiomify/testing': minor
'@axiomify/helmet': minor
'@axiomify/observability': minor
'@axiomify/cors': minor
'@axiomify/fingerprint': minor
'@axiomify/graphql': minor
'@axiomify/jobs': minor
'@axiomify/logger': minor
'@axiomify/metrics': minor
'@axiomify/openapi': minor
'@axiomify/rate-limit': minor
'@axiomify/sdk-runtime': minor
'@axiomify/security': minor
'@axiomify/socket.io': minor
'@axiomify/studio-ui': minor
'@axiomify/upload': minor
'@axiomify/vault': minor
---

Deliver the Axiomify 7.1 feature and release-readiness update across the workspace.

- Add `@axiomify/observability` with incoming W3C trace-context propagation, request-scoped custom timings, and browser-visible `Server-Timing` instrumentation.
- Add the cache, compression, database, session, and testing packages, including Redis-backed integrations, HTTP cache controls, transaction helpers, signed sessions, request injection, streaming assertions, and cookie-aware test clients.
- Expand authentication with PBKDF2 API keys, asymmetric RS/ES JWT support, remote JWKS verification, OAuth 2.0/OIDC discovery, and PKCE flows while removing obsolete legacy authentication paths.
- Extend core with signed and unsigned cookie primitives, group-scoped hooks, deprecation utilities, safer dispatch and validation behavior, and correct defaulted optional-field schema handling.
- Add native HTTP/2 with ALPN fallback, request timeouts, response/header hardening, RFC 9110 range responses, and cross-process WebSocket room delivery through Redis.
- Expand the CLI with database manifest commands, OpenAPI 3.1 validation, route snapshots and diffs, SDK generation improvements, richer diagnostics, and substantially smaller packed artifacts.
- Upgrade Studio with request building and collections, playground intelligence, traffic recording and replay, contracts, profiling, tracing, logs, metrics, jobs, WebSocket tooling, privacy controls, and improved lazy-loaded bundles.
- Improve OpenAPI generation, serverless adapters, SDK runtime behavior, static delivery, background jobs, logging, caching, compression, and supporting framework plugins.
- Preserve every file submitted to a multi-file upload field, expose repeated files as arrays, and clean partial uploads when request streams abort.
- Clarify explicit jobs-worker startup and accurately document the Node compatibility requirements of the Fetch-based serverless adapter.
- Source the Studio report version from the CLI package, render the sidebar badge from the current workspace release instead of stale hard-coded v1 values, and make documentation-link and package-policy validation portable in CI environments without ripgrep.
- Encode Playground base URLs with JSON string serialization so quotes, backslashes, and control characters cannot produce malformed or injectable generated code.
- Expand Studio and cross-package regression coverage for traffic profiling, request state and cookies, multipart uploads, streamed and SSE responses, OTLP retention, replay migration, runtime events, privacy controls, lifecycle reloads, OpenAPI fallbacks, SDK cache isolation, and database shutdown behavior.
- Add starters, recipes, examples, migration guidance, package documentation, API-versioning and contract-testing guides, and community contribution templates.
- Harden CI, CodeQL, release provenance, dependency policy, package validation, documentation-link checks, package-size limits, supported Node.js 22/24 verification, and strict test coverage gates.
- Align internal dependency ranges and coordinated Changesets behavior so peer updates remain on the 7.x release line and publish consistently as 7.1.0.
