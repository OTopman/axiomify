# Examples

All examples are aligned with the 5.0 API surface.

## Available examples

| File                            | Demonstrates                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `examples/native-server.ts`     | `@axiomify/native` adapter with manual lifecycle timing hooks                                          |
| `examples/native-zod-server.ts` | Minimal schema-first server using the native HTTP adapter                                              |
| `examples/openapi-server.ts`    | OpenAPI generation + Swagger UI (`useOpenAPI`)                                                         |
| `examples/graphql-server.ts`    | GraphQL endpoint via `useGraphQL` with depth + alias limits                                            |
| `examples/secure-server.ts`     | Logger PII masking + security plugin payload examples                                                  |
| `examples/my-app/src/index.ts`  | Fuller app: auth, uploads, OpenAPI, SSE, file streaming, WebSockets                                    |
| `examples/sdk-client-demo.ts`   | SDK consumption client: retries, circuit breaker, caching, paginators, offline queue, SSE & WebSockets |
| `examples/vault-server.ts`      | `@axiomify/vault` secure configuration environment management                                          |
| `examples/jobs-server.ts`       | `@axiomify/jobs` background tasks and compensating Saga workflows                                      |

## Notes

- `examples/my-app` uses function-based auth via `createAuthPlugin(...)` + `MemoryTokenStore`; for multi-process deployments, implement `TokenStore` against your store of choice.
- The `examples/my-app/package.json` declares `@axiomify/auth`, `@axiomify/native`, `@axiomify/openapi`, `@axiomify/graphql`, `@axiomify/helmet`, `@axiomify/logger`, `@axiomify/static`, `@axiomify/upload` plus the `graphql` peer.
- The OpenAPI and secure examples import `randomUUID` explicitly from `node:crypto` — no Web Crypto global assumption.
- Examples that need `JWT_SECRET` read from `process.env`. Copy `examples/my-app/.env.example` to `.env` and set a real 32-byte secret before running.

## Suggested starting point

Use the examples as patterns, not as a single unified starter:

- Start from `native-zod-server.ts` if you want the smallest mental model.
- Start from `openapi-server.ts` if you're building an API with first-class docs.
- Start from `vault-server.ts` if you want to see secure configuration management and environment switching.
- Start from `jobs-server.ts` if you want to see asynchronous background tasks and Saga workflows.
- Start from `my-app` if you want a full feature tour with auth, WebSockets, uploads, and SSE.
- Start from `sdk-client-demo.ts` if you want to see how to instantiate and configure a generated SDK client with advanced features (circuit breaker, retries, caching, paginators, offline queue, streaming).

## Exploring an example via the CLI

Every example exports its `Axiomify` instance, so you can inspect it with the CLI without booting a real server:

```bash
# See the full route surface, colour-coded by method, with validation badges.
npx axiomify routes examples/openapi-server.ts

# Generate the OpenAPI spec from any example.
npx axiomify openapi examples/my-app/src/index.ts -o /tmp/spec.json

# Run the static production-readiness audit against an example.
npx axiomify check examples/my-app/src/index.ts

# Generate multi-language SDKs for the example application.
npx axiomify sdk generate examples/my-app/src/index.ts -t typescript python go

# Boot the development server and automatically regenerate SDKs on the fly.
npx axiomify dev examples/my-app/src/index.ts --watch-sdk typescript python
```

If you're building a new example, follow the same pattern — wrap `adapter.listen()` in `if (require.main === module) { ... }` so the CLI can introspect the module without starting the server.
