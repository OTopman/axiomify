# @axiomify/core

The framework-agnostic engine behind Axiomify.

## Install

```bash
npm install @axiomify/core zod
```

## Constructor

```typescript
import { Axiomify } from '@axiomify/core';
import pino from 'pino';

const app = new Axiomify({
  timeout: 30_000, // request timeout in ms, 0 = disabled (default)
  logger: pino(), // injectable structured logger — strongly recommended in production
  telemetry: {
    // optional OpenTelemetry integration
    startSpan: (name, attrs) => tracer.startSpan(name, attrs),
  },
});
```

## `app.enableRequestId()`

Opt-in `X-Request-Id` injection. **Off by default since v5** — call this explicitly:

```typescript
app.enableRequestId();
```

Uses a module-level monotonic counter (per-process, shared across instances). Respects upstream `x-request-id` headers. Call before `adapter.listen()`.

## `app.route(definition)`

```typescript
app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string(), email: z.string().email() }),
    query: z.object({ page: z.coerce.number().default(1) }),
    params: z.object({ id: z.string().uuid() }),
    response: z.object({ id: z.string(), name: z.string() }),
    // or per-status: response: { 201: z.object(...), 400: z.object(...) }
  },
  // OpenAPI metadata lives in schema: alongside Zod fields
  plugins: [requireAuth, rateLimit],
  timeout: 5_000, // per-route timeout override
  handler: async (req, res) => {
    res.status(201).send({ id: 'usr_1', name: req.body.name });
  },
});
```

## `app.addHook(type, fn)`

Hooks run in registration order for each type:

```
onRequest → onPreHandler → plugins → validation → handler → onPostHandler
                                                                   ↑
                                              onError → (any of the above threw)
                                              onClose → (always, even on error)
```

```typescript
app.addHook('onRequest', (req, res) => {
  /* before routing */
});
app.addHook('onPreHandler', (req, res, { route, params }) => {
  /* after routing */
});
app.addHook('onPostHandler', (req, res, { route, params }) => {
  /* after handler */
});
app.addHook('onError', (err, req, res) => {
  /* handler threw */
});
app.addHook('onClose', (req, res) => {
  /* always last */
});
```

`onPreHandler` runs at dispatch time (not compiled into the route pipeline), so late-registered hooks still execute.

Hook fast paths (v5): `run()` returns `undefined` (not `Promise`) for empty lists — no microtask allocated.

## `app.group(prefix, options?, fn)`

```typescript
app.group('/api/v1', { plugins: [requireAuth] }, (v1) => {
  v1.route({ method: 'GET', path: '/me', handler: getMeHandler });
  v1.group('/admin', { plugins: [requireAdmin] }, (admin) => {
    admin.route({
      method: 'DELETE',
      path: '/users/:id',
      handler: deleteUserHandler,
    });
  });
});
```

## `app.use(configurator | module)`

```typescript
// Configurator — function
app.use((app, ctx) => {
  ctx.provide('redis', redisClient);
  app.addHook('onRequest', trackRequest);
});

// Module — named, with dependency declaration
app.use({
  name: 'auth',
  dependencies: ['cors'], // resolved via Kahn's algorithm regardless of call order
  register: (app, ctx) => {
    const redis = ctx.resolve<Redis>('redis');
    app.addHook('onRequest', verifyJWT);
  },
});
```

## `app.setSerializer(fn)`

Replace the default `{ status, message, data }` envelope:

```typescript
app.setSerializer(({ data, message, statusCode, isError }) => ({
  ok: !isError && statusCode < 400,
  payload: data,
  msg: message,
}));
```

Rules:

- **Single-argument signature only.** The 4.x positional form
  `(data, message, statusCode, isError, req) => ...` was removed in 5.0
  and now throws at adapter construction time.
- **Must be synchronous.** Async serializers throw at construction —
  `JSON.stringify(Promise)` would produce `[object Promise]` and silently
  corrupt every response body. Do async work in an `onPostHandler` hook
  or in the route handler itself.
- **Call before adapter construction.** Once a `NativeAdapter` is built,
  the serializer is locked — the adapter pre-builds cached error envelopes
  (404 / 405 / 413 / 500) from the configured serializer, and a late swap
  would produce inconsistent shapes between cached fallbacks and live
  responses. `setSerializer` throws after `lockRoutes`.
- `app.serializer` is a read-only getter. Direct assignment was never
  supported.

## Adapter protocol

Third-party adapters authenticate with `ADAPTER_LOCK_TOKEN`:

```typescript
import { ADAPTER_LOCK_TOKEN } from '@axiomify/core';

// After mounting all routes — prevents late registration
app.lockRoutes(ADAPTER_LOCK_TOKEN, '@my/adapter');

// Dispatch a pre-resolved route
await app.handleMatchedRoute(ADAPTER_LOCK_TOKEN, req, res, route, params);
```

Both methods throw with a clear error if called without the token.

## Validation internals

### AJV + transform detection

At startup, for each route:

1. `z.toJSONSchema(schema)` → JSON Schema 2020-12
2. `ajv.compile(jsonSchema)` → compiled validator (~0.06 µs/call)
3. `hasTransforms(schema)` → does this schema have `.transform()`, `.default()`, `.coerce`, `.refine()`, `.catch()`, `.pipe()`?

At request time:

- AJV validates structure via the compiled function
- If invalid → AJV error map returned immediately (AJV's compiled error path is significantly faster than Zod's `safeParse` error path; concrete numbers vary by schema complexity — run `benchmarks/stress.mjs` on your own hardware to measure)
- If valid AND no transforms → input returned directly (Zod parse pass skipped)
- If valid AND transforms present → `schema.parse()` applies them
- If AJV is not installed → falls back to Zod `safeParse` for everything (correct, ~1.6× slower than the AJV path)

### Response validation

- `NODE_ENV=production` → mismatch logs via injected logger, continues
- `NODE_ENV=development` / `test` → mismatch throws immediately (caught during development)

## New types in v5

| Export                 | Description                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADAPTER_LOCK_TOKEN`   | `unique symbol` — adapter authentication token                                                                                                   |
| `AdapterLockToken`     | TypeScript type of the token                                                                                                                     |
| `AxiomifyLogger`       | `{ warn, error }` — injectable logger interface                                                                                                  |
| `defaultLogger`        | `console`-backed default                                                                                                                         |
| `AppModule`            | Named plugin with dependency declaration                                                                                                         |
| `AppConfigurator`      | `(app, ctx) => void` — preferred plugin form                                                                                                     |
| `AppContext`           | `{ provide, resolve }` — dependency injection context                                                                                            |
| `OpenApiOperation`     | OpenAPI 3.1.0 Operation Object metadata for a route (`route.openapi`). Field shape mirrors the spec verbatim — see [openapi docs](./openapi.md). |
| `RouteMeta`            | **Deprecated alias for `OpenApiOperation`.** Kept through 5.x for back-compat; removed in 6.0.                                                   |
| `RouteMiddleware`      | `(req, res) => void \| Promise<void>` — per-route middleware function.                                                                           |
| `ResponseCapabilities` | `{ sse: boolean, streaming: boolean }`                                                                                                           |
| `SseCapableResponse`   | `AxiomifyResponse` with required `sseInit` / `sseSend`                                                                                           |
