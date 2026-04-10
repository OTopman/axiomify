# Changelog

## v3.0.0
- **Feature**: Added structured logging package (`@axiomify/logger`) with PII masking via `maskify-ts`.
- **Feature**: Added fully-functional Hapi adapter (`@axiomify/hapi`).
- **Security**: Hardened file upload plugin (`@axiomify/upload`) to stream directly to disk, bypassing RAM entirely. Included unhandled rejection safety buffers.
- **Feature**: Added OpenAPI generator (`@axiomify/openapi`) deriving Swagger docs directly from route schemas.

## v2.0.0
- **Core Optimization**: Introduced custom Radix Tree Router reducing path resolution to O(k).
- **Validation**: Added ahead-of-time Zod compiler.
- **Adapters**: Built adapter abstraction with Express and Fastify support.