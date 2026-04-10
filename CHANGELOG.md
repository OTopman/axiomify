# Changelog

## v3.1.0

### ✨ Features
- **Core**: Introduced a route-level plugin system (`app.registerPlugin()`) allowing targeted middleware execution on specific routes prior to schema validation.
- **Feature**: Added wildcard route segment support (`*`) for fallbacks, static proxying, and catch-all 404 handlers.
- **Feature**: Introduced global and per-route request timeouts (`timeout: ms`) to safely bound connection lifespan and automatically dispatch `503 Service Unavailable`.
- **Bug Fix**: Added missing `@axiomify/core` to `@axiomify/upload` dependencies.

### 🐛 Bug Fixes
- **Core**: Enforced strict generics on `addHook()` handlers to prevent silent lifecycle failures and eliminate escaping `any` types.
- **Core**: Activated response validation (`schema.response`) to strictly enforce outgoing payload shapes (throws in development, warns in production).
- **Logger**: Re-engineered payload interception to correctly log outgoing responses and accurately calculate request `durationMs` via `process.hrtime.bigint()`.
- **Hapi Adapter**: Disabled default payload parsing and forced native streams to restore `@axiomify/upload` compatibility.
- **Upload**: Hardened the busboy streaming pipeline against unhandled promise rejections and race conditions during stream failures.
- **CLI**: Standardized dynamic `externals` resolution across `build`, `dev`, and `routes` commands to prevent bundling external server adapters.
- **OpenAPI**: Removed dead legacy generator code and safely handled optional schema objects.
- **Docs**: Corrected the Radix Tree routing time complexity claim from O(1) to a factual O(k, where k = path depth).

## v3.0.0
- **Feature**: Added structured logging package (`@axiomify/logger`) with PII masking via `maskify-ts`.
- **Feature**: Added fully-functional Hapi adapter (`@axiomify/hapi`).
- **Security**: Hardened file upload plugin (`@axiomify/upload`) to stream directly to disk, bypassing RAM entirely. Included unhandled rejection safety buffers.
- **Feature**: Added OpenAPI generator (`@axiomify/openapi`) deriving Swagger docs directly from route schemas.

## v2.0.0
- **Core Optimization**: Introduced custom Radix Tree Router reducing path resolution to O(k).
- **Validation**: Added ahead-of-time Zod compiler.
- **Adapters**: Built adapter abstraction with Express and Fastify support.