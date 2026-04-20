# @axiomify/static

## 5.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [6eaa652]
- Updated dependencies [43f1afd]
- Updated dependencies [60e06b6]
- Updated dependencies [20e9123]
- Updated dependencies [ea38646]
  - @axiomify/core@5.0.0
