---
'@axiomify/rate-limit': minor
'@axiomify/express': minor
'@axiomify/fastify': minor
'@axiomify/metrics': minor
'@axiomify/openapi': minor
'axiomify-app': minor
'@axiomify/helmet': minor
'@axiomify/logger': minor
'@axiomify/static': minor
'@axiomify/upload': minor
'@axiomify/auth': minor
'@axiomify/core': minor
'@axiomify/cors': minor
'@axiomify/hapi': minor
'@axiomify/http': minor
'@axiomify/cli': minor
'@axiomify/ws': minor
---

Add `@axiomify/graphql` package — drop-in GraphQL endpoint for Axiomify.

Mounts POST and GET endpoints at a configurable path, with a built-in
GraphiQL 3 playground. Supports per-request context factories, custom
depth and alias limits for abuse prevention, and additional validation
rules beyond the GraphQL spec defaults.

### Exports

- `useGraphQL(app, options)` — registers the GraphQL endpoint on an `Axiomify` instance
- `GraphQLPluginOptions` — full options interface
- `GraphQLContextFactory` — type for the per-request context factory
- `GraphQLResult` — response envelope type

### Routes registered

- `POST /graphql` — primary query endpoint (`query`, `variables`, `operationName`)
- `GET /graphql` — query-string queries for tooling and introspection
- `GET /graphql/playground` — GraphiQL UI (disable with `playground: false`)

### Security controls

- `maxDepth` — rejects queries exceeding a depth threshold before schema execution
- `maxAliases` — rejects queries exceeding an alias count threshold
- `validationRules` — accepts extra validation rules alongside the spec defaults

Resolver errors follow the GraphQL spec: HTTP 200 with `{ errors: [...] }`.
Only malformed requests (bad parse, failed validation, unparseable variables)
return 4xx.

`graphql ^16.0.0` is a peer dependency.
