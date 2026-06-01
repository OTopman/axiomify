# @axiomify/sdk-runtime

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

## 6.1.0

### Minor Changes

- 0e5ffdb: **Enterprise Type-Safe SDK Generation Platform**

  This release introduces the highly anticipated SDK Generation Platform, allowing you to generate multi-language client SDKs directly from your Axiomify backend, OpenAPI specs, or GraphQL schemas.
  - **`axiomify sdk generate`**: Generate fully-typed SDKs for TypeScript, Python, Go, Swift, Kotlin, and Dart using our novel `TypeGraph` AST compiler.
  - **`axiomify sdk diff`**: CI/CD tooling to compare API schemas and prevent breaking changes from reaching production.
  - **`axiomify sdk validate`**: Strict syntactic and semantic validations for your schemas.
  - **Live Watch Mode**: Run `axiomify dev --watch-sdk <langs...>` to automatically regenerate SDKs on the fly when your backend code changes.
  - **`@axiomify/sdk-runtime`**: A new zero-dependency networking package that powers generated TypeScript SDKs with built-in retry engines, interceptors, and OAuth2 authentication injection.
