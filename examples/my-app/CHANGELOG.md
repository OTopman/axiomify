# axiomify-app

## 6.0.0

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
  - @axiomify/auth@6.2.1
  - @axiomify/graphql@6.2.1
  - @axiomify/helmet@6.2.1
  - @axiomify/logger@6.2.1
  - @axiomify/native@6.2.1
  - @axiomify/openapi@6.2.1
  - @axiomify/static@6.2.1
  - @axiomify/upload@6.2.1

## 5.0.0

### Major Changes

- 60e06b6: Axiomify v3.0.0 is now a secure, zero-overhead, enterprise-ready Node.js framework that perfectly bridges strict schema-first type safety with raw, Fastify-level performance across all major adapters
- ea38646: ### ⚠️ Breaking Changes
  - **cors**: Configuration errors now throw at startup instead of failing silently. If you were relying on permissive defaults, you must now explicitly configure allowed origins/methods.
  - **ws**: `useWebSockets()` signature changed: second parameter is now `WebSocketOptions` object (was `boolean`). Update calls from `app.useWebSockets(server, true)` → `app.useWebSockets(server, { enabled: true })`.
  - **upload**: Filename sanitization is now stricter. Paths like `../../etc/passwd` or filenames with null bytes are rejected with `ValidationError`. If your app relied on raw filename passthrough, wrap filenames with `sanitizeFilename()` from `@axiomify/upload`.
  - **http**: `statusCode` on responses is now validated as 100-599. Invalid codes throw `InvalidStatusCodeError` instead of being passed through.

  ### 🆕 New Packages

  Seven new ecosystem packages are now available:

  | Package                | Description                                                            |
  | ---------------------- | ---------------------------------------------------------------------- |
  | `@axiomify/auth`       | JWT + API key authentication middleware with role-based access control |
  | `@axiomify/cors`       | Strict, configurable CORS handling with preflight caching              |
  | `@axiomify/helmet`     | Security headers preset (CSP, HSTS, X-Frame-Options) via Helmet.js     |
  | `@axiomify/metrics`    | OpenTelemetry-compatible metrics collection + Prometheus exporter      |
  | `@axiomify/rate-limit` | Sliding-window rate limiting with Redis/memory backends                |
  | `@axiomify/static`     | Efficient static file serving with cache headers + compression         |
  | `@axiomify/ws`         | WebSocket integration with lifecycle hooks + backpressure handling     |

  All packages follow the same adapter pattern: use with Express, Fastify, or Hapi without changing your business logic.

  ### 🛠️ Improvements & Fixes

  #### Core
  - Added `gracefulShutdown()` primitive: handles SIGTERM/SIGINT, drains connections, and triggers teardown hooks [[#142]]
  - Added `healthCheck()` utility: configurable liveness/readiness endpoints with dependency checks [[#145]]
  - OpenTelemetry context propagation now automatic for all adapters [[#138]]
  - Fixed multibyte character handling in request body parsing (UTF-8, emoji) [[#129]]
  - Error serialization now includes `cause` chain for better debugging [[#133]]

  #### Adapter-Specific
  - **fastify**: Fixed wildcard route matching edge case; added `sanitizePath` option [[#127]]
  - **hapi**: Rewrote body parsing to handle `application/json` + `multipart/form-data` consistently [[#131]]
  - **express**: Improved error middleware compatibility with async handlers [[#124]]
  - **upload**: Added `maxFileSize`, `allowedMimeTypes` validation; fixed path traversal vulnerability [[#140]]

  #### Security
  - All packages now run `npm audit --audit-level=high` in CI [[#147]]
  - Added `SECURITY.md` with vulnerability disclosure process
  - CodeQL scanning enabled for all branches (not just `main`)

  #### Testing
  - Added 113+ new tests covering auth flows, CORS preflight, WebSocket lifecycle, and error boundaries
  - Coverage threshold raised to 85% across all packages
  - Added type-level tests with `expectTypeOf` for public API guarantees

  ### 📦 Build & Tooling
  - CI now uploads coverage to Codecov (badge in README is now live)
  - Fixed duplicate `npm run build` in test workflow (~40s saved per run)
  - Release workflow updated to Node 22 LTS (was 23)
  - Changesets configured for atomic multi-package releases

### Minor Changes

- 6eaa652: **Feature: Route-Level Plugins & System Stabilization**
  - **@axiomify/core**: Introduced a route-level plugin system (`app.registerPlugin()`) for targeted middleware execution. Enforced strict generics on `addHook()` and activated runtime response validation.
  - **@axiomify/logger**: Re-engineered payload interception on the `onPreHandler` hook for accurate `durationMs` tracking and reliable outgoing response logging.
  - **@axiomify/hapi**: Disabled default payload parsing to restore native stream compatibility for file uploads.
  - **@axiomify/upload**: Hardened the busboy pipeline against unhandled promise rejections during stream failures and race conditions.
  - **@axiomify/cli**: Standardized dynamic `externals` resolution across `build`, `dev`, and `routes` commands to prevent bundling external adapters.
  - **@axiomify/openapi**: Cleaned up legacy generator code and improved optional schema handling.

- 43f1afd: - **docs:** Added `README.md` files to all 9 monorepo packages to ensure proper documentation rendering on the npm registry.
- f9ab6d8: Add `@axiomify/graphql` package — drop-in GraphQL endpoint for Axiomify.

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

- 20e9123: **Features**
  - **@axiomify/cors**: Introduced a new framework-agnostic CORS plugin with automatic preflight `OPTIONS` handling.

### Patch Changes

- Updated dependencies [6eaa652]
- Updated dependencies [43f1afd]
- Updated dependencies [f9ab6d8]
- Updated dependencies [60e06b6]
- Updated dependencies [20e9123]
- Updated dependencies [ea38646]
- Updated dependencies [967007f]
  - @axiomify/express@5.0.0
  - @axiomify/openapi@5.0.0
  - @axiomify/upload@5.0.0
  - @axiomify/core@5.0.0
  - @axiomify/http@5.0.0
  - @axiomify/metrics@5.0.0
  - @axiomify/static@5.0.0
  - @axiomify/auth@5.0.0
  - @axiomify/ws@5.0.0
