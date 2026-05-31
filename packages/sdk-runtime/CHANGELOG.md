# @axiomify/sdk-runtime

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
