---
'@axiomify/fingerprint': major
'@axiomify/sdk-runtime': major
'@axiomify/socket.io': major
'@axiomify/studio-ui': major
'@axiomify/security': major
'@axiomify/graphql': major
'@axiomify/metrics': major
'@axiomify/openapi': major
'axiomify-app': major
'@axiomify/helmet': major
'@axiomify/logger': major
'@axiomify/native': major
'@axiomify/static': major
'@axiomify/upload': major
'@axiomify/vault': major
'@axiomify/auth': major
'@axiomify/core': major
'@axiomify/cors': major
'@axiomify/jobs': major
'@axiomify/cli': major
'@axiomify/ws': major
---

Security hardening across the framework (remediation of a full security audit), new opt-in safety controls, and documentation reconciled with the implementation.

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
