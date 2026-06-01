# @axiomify/ws

## 6.2.1

### Patch Changes

- 6a86ad9: Fix spurious `ValidationError` on castable string values in query, params, and body validation.

  **Problem**: HTTP query strings and URL params always arrive as strings. When a schema declared `z.number()`, the raw value `"5"` was rejected by AJV (`coerceTypes: false`) before Zod could parse it — throwing `ValidationError` for perfectly valid input.

  **Fix**: Added a `preCoerce()` step that converts string values to their schema-declared types before validation. Query and params use Zod-only validation (AJV bypassed since these are always strings). Body applies pre-coercion before the AJV fast-rejection filter, preserving the ~428× error-path performance advantage.

  **Coercion rules**:
  - String → number/integer: `"5"` → `5`, `"0"` → `0`, `"-10"` → `-10`, `"9.99"` → `9.99` (rejects NaN)
  - String → boolean: `"true"` → `true`, `"false"` → `false`
  - Nested objects and arrays coerced recursively
  - Non-castable values left as-is for proper `ValidationError` rejection

  No application code changes required. Users who used `z.coerce.number()` as a workaround can optionally simplify to `z.number()`.

- Updated dependencies [6a86ad9]
  - @axiomify/core@6.2.1
  - @axiomify/native@6.2.1

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
