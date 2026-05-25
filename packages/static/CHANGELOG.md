# @axiomify/static

## 6.0.0

### Major Changes

- facf7b6: Release v6.0.0

### Patch Changes

- Updated dependencies [facf7b6]
  - @axiomify/core@6.0.0

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

- 967007f: # Axiomify v5.0.0

  This release is a comprehensive overhaul of the framework. It includes four new packages,
  a rewritten core architecture, verified multi-core clustering with measured 160–165% scaling,
  AJV-compiled validation with transform-aware fast paths, and several breaking API changes.

  ***

  ## ⚠️ Breaking changes

  ### `X-Request-Id` is now opt-in

  In v4, every `Axiomify` instance injected `X-Request-Id` on every response automatically.
  This was a per-request cost paid even by applications that never needed request tracing.

  **Migration:** call `app.enableRequestId()` explicitly after constructing the app:

  ```ts
  // Before (v4):
  const app = new Axiomify(); // X-Request-Id injected automatically

  // After (v5):
  const app = new Axiomify();
  app.enableRequestId(); // opt in
  ```

  ### `app.serializer` is now a read-only getter

  Direct assignment to `app.serializer` bypassed the arity normalisation in `setSerializer()`.

  **Migration:** use `app.setSerializer(fn)` — which was already the documented API:

  ```ts
  // Before (v4 — worked but was undocumented):
  app.serializer = myFn;

  // After (v5 — use the setter):
  app.setSerializer(myFn);
  ```

  ### `lockRoutes()` and `handleMatchedRoute()` require `ADAPTER_LOCK_TOKEN`

  Both methods are part of the adapter protocol, not the public user API. In v4, the `@internal`
  JSDoc comment provided no runtime enforcement. User code could call them accidentally, causing
  silent route drift or double-dispatch.

  **Impact:** only custom adapter authors who call these methods directly are affected.
  Application code does not call these methods.

  **Migration for custom adapters:**

  ```ts
  import { ADAPTER_LOCK_TOKEN } from '@axiomify/core';

  // Before (v4):
  app.lockRoutes('@my/adapter');
  await app.handleMatchedRoute(req, res, route, params);

  // After (v5):
  app.lockRoutes(ADAPTER_LOCK_TOKEN, '@my/adapter');
  await app.handleMatchedRoute(ADAPTER_LOCK_TOKEN, req, res, route, params);
  ```

  ### `RoutePlugin` / `PluginHandler` renamed to `RouteMiddleware`

  The old names are deprecated aliases that remain exported until v6.
  No change needed immediately, but migrate to `RouteMiddleware` to avoid warnings.

  ### `AxiomifyRequest.body`, `.query`, `.params` are now writable

  These were `readonly` in v4. Writable is required for the validation layer to write
  transform results back onto the request object without `Object.defineProperty` (which
  degraded V8's hidden-class optimisation). No migration needed — this is a relaxation.

  ### `res.sseInit()` and `res.sseSend()` are now optional on `AxiomifyResponse`

  The base `AxiomifyResponse` interface now has `sseInit?` and `sseSend?` (optional).
  The new `SseCapableResponse` type declares them as required for adapters that support SSE.
  If you type-checked against `AxiomifyResponse` and called `.sseInit()` without checking
  capability, TypeScript will now warn you. Add a capability check:

  ```ts
  if (res.capabilities.sse) {
    (res as SseCapableResponse).sseInit();
  }
  ```

  ### Clustering: SCHED_NONE + SO_REUSEPORT (all adapters)

  `listenClustered()` previously used Node.js cluster's `SCHED_RR` default, where the primary
  accepts every TCP connection and forwards file descriptors to workers via IPC. This was a
  bottleneck regardless of worker count.

  Workers now bind their own sockets via `reusePort: true` (Node ≥ 16.9) / `exclusive: true`
  (older Node), with `cluster.SCHED_NONE` set before the first fork. The kernel distributes
  connections at the socket layer — zero IPC in the hot path.

  This is not a breaking change in the API, but the `workers` option default changed from
  `os.cpus().length` to `os.availableParallelism()`. In most environments these are identical.
  In containers with CPU limits, `availableParallelism()` returns the correct value.

  ***

  ## 🆕 New packages

  ### `@axiomify/native` — uWebSockets.js adapter

  The highest-throughput Axiomify adapter. Uses uWS's C++ routing (routes are registered
  directly via `server.get()`, `server.post()`, etc. — the Axiomify router is not in the hot
  path), SO_REUSEPORT clustering, and a lightweight bridge layer for Express-compatible
  middleware.

  Measured on an 8-core machine: **73,511–83,947 req/s** single-process (range reflects
  GET vs POST/echo). Native uWS is bottlenecked by autocannon on co-located hardware above
  ~90k req/s.

  ```ts
  import { NativeAdapter } from '@axiomify/native';

  const adapter = new NativeAdapter(app, { port: 3000 });
  adapter.listenClustered({
    onWorkerReady: () => console.log(`[${process.pid}] ready`),
    onPrimary: (pids) => console.log('Workers:', pids),
  });
  ```

  ### `@axiomify/graphql` — GraphQL endpoint

  Drop-in GraphQL endpoint with GraphiQL 3 playground, per-request context factories,
  depth/alias limits, and custom validation rules.

  ```ts
  import { useGraphQL } from '@axiomify/graphql';
  useGraphQL(app, {
    schema,
    context: (req) => ({ user: req.state.user }),
    maxDepth: 10,
  });
  ```

  ### `@axiomify/security` — XSS, HPP, SQLi, prototype pollution

  Request-level security heuristics: XSS pattern detection, HTTP Parameter Pollution (HPP)
  normalisation, SQL injection heuristics, prototype pollution detection, null-byte filtering,
  and basic bot detection.

  ```ts
  import { useSecurity } from '@axiomify/security';
  useSecurity(app, { xss: true, hpp: true, sqlInjection: true });
  ```

  ### `@axiomify/fingerprint` — Server-side request fingerprinting

  Generates a confidence-scored fingerprint for each request based on headers, TLS
  characteristics, and behavioural signals. Useful for bot detection, rate limiting by
  device rather than IP, and fraud detection.

  ```ts
  import { useFingerprint } from '@axiomify/fingerprint';
  useFingerprint(app, { store: redis });
  ```

  ***

  ## ⚡ Performance

  ### Validator: AJV + transform-aware fast path (15–25% throughput gain on validated routes)

  Previously every validated request ran AJV then unconditionally re-ran `schema.parse()`.
  `hasTransforms()` now walks the Zod schema tree once at startup. Schemas with no
  `.transform()`, `.default()`, `.coerce`, `.refine()`, or `.catch()` skip `schema.parse()`
  entirely — AJV's validated output is returned directly.

  Error path: 428× faster than Zod's error path (AJV collects all errors in one pass;
  Zod walks the tree for each field).

  Also removed the unnecessary shallow-clone of request body before AJV — `coerceTypes: false`
  means AJV never mutates its input. One fewer allocation per validated request.

  ### Core: microtask-free hook fast path

  `HookManager.run()` returns `undefined` (not `Promise<void>`) when no hooks are registered.
  Callers check before `await`, so the zero-hook case allocates no Promise and queues no
  microtask. Single-handler lists call the handler directly without a loop.

  ### Dispatcher: allocation reduction

  - `ValidatingResponse` wrapper allocated only for routes with `schema.response` or HEAD method
  - Router writes params directly into caller-provided `req.params` — no intermediate object
  - `Object.assign` replaces `for-in` for params copy (V8 inline cache, no prototype walk)
  - Single-step pipeline unrolled (no loop for handler-only routes)

  ### Clustering: verified 160–165% scaling at 2 workers (8-core machine)

  - `@axiomify/http` 2w: **57,200 req/s (160% of 1-worker baseline)**
  - `@axiomify/fastify` 2w: **35,200 req/s (165% of 1-worker baseline)**

  Previous versions showed <10% gain at 2 workers because the primary-IPC bottleneck
  capped throughput regardless of worker count.

  ***

  ## 🆕 New core APIs

  ### `app.enableRequestId()`

  Opt-in X-Request-Id injection. Uses a module-level monotonic counter (per-process,
  shared across multiple `Axiomify` instances). Respects upstream `x-request-id` headers.

  ### `AxiomifyOptions.logger`

  Inject a structured logger (Pino, Winston) at construction:

  ```ts
  import pino from 'pino';
  const app = new Axiomify({ logger: pino() });
  ```

  Forwarded to `HookManager` (hook errors) and `ValidationCompiler` (response-schema
  mismatches). Without a custom logger, `console` is used — not suitable for production
  observability stacks.

  ### `ADAPTER_LOCK_TOKEN` + `AxiomifyLogger` exports

  New exports from `@axiomify/core`:

  | Export               | Type            | Description                                         |
  | -------------------- | --------------- | --------------------------------------------------- |
  | `ADAPTER_LOCK_TOKEN` | `unique symbol` | Required by `lockRoutes()` / `handleMatchedRoute()` |
  | `AdapterLockToken`   | type            | TypeScript type of the token                        |
  | `AxiomifyLogger`     | interface       | `{ warn, error }` — injectable logger interface     |
  | `defaultLogger`      | value           | `console`-backed default `AxiomifyLogger`           |

  ### `AppModule` + `AppConfigurator` + `AppContext`

  Structured module system with topological dependency resolution (Kahn's algorithm):

  ```ts
  app.use({
    name: 'auth',
    dependencies: ['cors'],
    register: (app, ctx) => {
      ctx.provide('tokenStore', new RedisTokenStore(redis));
      app.addHook('onRequest', verifyToken);
    },
  });
  ```

  ### `RouteMeta`

  Documentation metadata separated from validation schemas:

  ```ts
  app.route({
    method: 'POST',
    path: '/users',
    schema: { body: CreateUserSchema },
    meta: {
      tags: ['Users'],
      description: 'Create a new user',
      summary: 'Create user',
    },
    handler: createUser,
  });
  ```

  ***

  ## 🔧 Adapter improvements

  ### All adapters: crash circuit breaker

  5+ worker crashes within 30 s aborts the primary process with a clear error, preventing
  runaway respawn loops on misconfigured workers (bad env, failed migration, port conflict).

  ### All adapters: SIGUSR2 rolling restart

  Zero-downtime reload on `kill -USR2 <primary-pid>`. Workers are killed one at a time,
  spaced by `gracefulTimeoutMs`, so a replacement is always serving before the next is
  terminated.

  ### `@axiomify/hapi`: SO_REUSEPORT via `net.Server` injection

  Hapi's `server.start()` does not expose `reusePort` directly. The adapter now pre-binds
  a `net.Server` with `reusePort: true` and injects it as Hapi's `listener`. This achieves
  the same zero-IPC socket distribution as the native and http adapters.

  ***

  ## 📦 Ecosystem upgrades

  ### `@axiomify/openapi`: Zod v4 native

  Uses `z.toJSONSchema()` (Zod v4 built-in, emits JSON Schema 2020-12) instead of
  `zod-to-json-schema`, which returned empty `{}` for all Zod v4 schemas.

  ### `@axiomify/auth`: token revocation + JWT algorithm pinning

  - Access token revocation via `TokenStore` (checked on every authenticated request)
  - Refresh token rotation with configurable TTL
  - Algorithm pinning — tokens signed with non-listed algorithms are rejected at startup
  - Weak secrets (< 32 chars) throw at startup

  ### `@axiomify/rate-limit`: EVALSHA caching

  Redis Lua script is uploaded once at startup; subsequent calls use the 40-byte SHA hash.
  Reduces Redis round-trip size per rate-limit check.

  ### `@axiomify/logger`: PII masking

  Recursive PII masking via inline implementation (removed `maskify-ts` dependency which
  had a hard `reflect-metadata` runtime dependency that polluted many environments).

  ### `@axiomify/ws`: all-adapter WebSocket

  `getServerFromAdapter()` helper works with Express, Fastify, Hapi, and HTTP adapters.
  `@axiomify/native` uses uWS's built-in WebSocket for maximum performance.

  ***

  ## 📊 Benchmark reference (autocannon · 100 conns · pipelining 10 · 12 s · Node 22 · 8-core)

  ### Single process

  | Server                                       |      Req/s |   Avg lat |       p99 |
  | -------------------------------------------- | ---------: | --------: | --------: |
  | Bare Node.js http                            |     43,765 |     22 ms |     54 ms |
  | Bare Fastify 5                               |     41,779 |     23 ms |     53 ms |
  | **Axiomify Native — GET /:id/posts/:postId** | **83,947** | **11 ms** | **20 ms** |
  | **Axiomify Native — GET /ping**              | **73,511** | **13 ms** | **26 ms** |
  | **Axiomify Native — POST /echo**             | **54,720** | **18 ms** | **30 ms** |
  | Axiomify + `@axiomify/http`                  |     32,841 |     30 ms |     91 ms |
  | Axiomify + `@axiomify/fastify`               |     31,334 |     31 ms |     58 ms |

  ### Clustered (co-located loadgen — 4w regresses due to autocannon starvation)

  | Adapter             |     1w |     2w |  Scaling |
  | ------------------- | -----: | -----: | -------: |
  | Native (uWS)        | 85,000 | 91,300 |    107%† |
  | `@axiomify/http`    | 35,800 | 57,200 | **160%** |
  | `@axiomify/fastify` | 21,300 | 35,200 | **165%** |

  † Native at 2w is autocannon-limited (autocannon saturates ~90k req/s co-located).
  With a dedicated loadgen machine, expect near-linear scaling to physical core count.

### Minor Changes

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

### Patch Changes

- Updated dependencies [6eaa652]
- Updated dependencies [43f1afd]
- Updated dependencies [f9ab6d8]
- Updated dependencies [60e06b6]
- Updated dependencies [20e9123]
- Updated dependencies [ea38646]
- Updated dependencies [967007f]
  - @axiomify/core@5.0.0
