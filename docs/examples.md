# Examples

The example entrypoints were reviewed and aligned with the current API surface.

## Reviewed Examples

- `examples/express-server.ts`: Express adapter plus manual lifecycle timing hooks
- `examples/native-zod-server.ts`: minimal schema-first server using the native HTTP adapter
- `examples/openapi-server.ts`: OpenAPI generation plus Swagger UI
- `examples/secure-server.ts`: logger masking and a security-oriented payload example
- `examples/my-app/src/index.ts`: a fuller app showing auth, uploads, OpenAPI, SSE, file streaming, and WebSockets

## Notes

- `examples/my-app` now uses function-based auth plugins through `createAuthPlugin(...)`
- `examples/my-app/package.json` now includes `@axiomify/auth`
- the OpenAPI and secure examples now import `randomUUID` explicitly instead of relying on a global
- the native example now uses `@axiomify/http`, which matches its intent better than the Express adapter

## Suggested Usage

Use the examples as patterns, not as a single unified starter.

- start from `native-zod-server.ts` if you want the smallest mental model
- start from `express-server.ts` if you are migrating an Express app
- start from `my-app` if you want a feature tour
