# @axiomify/ws

## 6.2.0

### Minor Changes

- 364f772: Hardened security posture, new authorization primitives, and automatic resource cleanup across the framework.

  **Core**: Route conflict detection (`routeConflict`), strict schema guard (`strictSchema`), DI container sealed post-bootstrap, production error masking, `req.state` write-once immutability, and `setNotFoundHandler` / `setMethodNotAllowedHandler` as first-class APIs.

  **WebSockets**: Room authorization via `beforeJoin` hook and `allowlist` pattern with default-deny posture. Opt-in per-message sanitization via `@axiomify/security`.

  **Upload**: Automatic temp-file cleanup (`autoCleanup`), explicit `req.cleanup()`, and `req.uploadedFiles` tracking.

  **CLI**: `sdk generate` now ingests AsyncAPI 2.x specs automatically alongside OpenAPI and GraphQL.

  **Auth**: HS256 secret minimum enforced at 32 bytes (RFC 7518 §3.2) at plugin registration.

  **Security**: NoSQL pattern set extended, ReDoS hardening on sanitizer, prototype pollution option documented.

  **Native**: Startup warning when `trustProxy` is enabled without a `proxyIpValidator`.

### Patch Changes

- Updated dependencies [364f772]
  - @axiomify/native@6.2.0
  - @axiomify/core@6.2.0

## 6.1.0

### Patch Changes

- @axiomify/core@6.1.0
- @axiomify/native@6.1.0
