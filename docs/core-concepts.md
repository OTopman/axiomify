# Core Concepts

## How Axiomify works

Axiomify separates three concerns that most frameworks conflate:

1. **Schema** — Zod, the single source of truth for runtime validation, TypeScript types, and OpenAPI specs
2. **Pipeline** — hooks + plugins + handler, composed at route registration time
3. **Transport** — the NativeAdapter (uWebSockets.js) handles TCP and protocol details natively

You write routes once and the framework executes them at lightning speed.

---

## Routing

Routes are registered on `Axiomify` and dispatched by **two** routers depending on the entrypoint:

```typescript
app.route({
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD',
  path: '/users/:id',       // Axiomify :param syntax
  schema: { ... },          // optional Zod schemas
  plugins: [requireAuth],   // optional plugins, run before handler
  timeout: 5_000,           // per-route timeout (ms), 0 = disabled
  handler: async (req, res) => { ... },
});
```

- **Production (`@axiomify/native`)** — each route is registered directly with `uWebSockets.js` at startup. Method + path matching happens in C++ with zero JavaScript on the routing hot path. `app.handleMatchedRoute()` is called with a pre-resolved route, so the dispatcher skips routing entirely.
- **Test / SSR (`app.handle()`)** — the JS radix trie in `packages/core/src/router.ts` matches the route. Used by unit tests, server-side rendering, and any embedder that drives the framework without an HTTP adapter. Production traffic never touches this code path.

The JS radix trie uses character-by-character path walking with a pre-allocated flat param accumulator — no `split('/')` allocation per lookup, no spread per matched segment. Lookup is O(k) where k = path depth. It also powers 404 vs 405 disambiguation (registered method enumeration for the `Allow` header).

---

## Validation — compiled AJV with Zod transform pass

Zod schemas are not evaluated at request time. At route registration:

1. `z.toJSONSchema(schema)` converts the Zod schema to JSON Schema 2020-12 (Zod v4 built-in).
2. `AJV.compile(jsonSchema)` produces a compiled validator function.
3. The compiled function is stored on the route — no schema introspection at request time.

At request time:

- **AJV validates structure** — the compiled function does the structural check.
- **`schema.parse(data)` runs a second pass only when the schema declares transforms** (`.default()`, `.coerce.*`, `.transform()`). On transform-free schemas the second pass is skipped entirely.

When AJV is not installed (it's a peer dependency), the framework falls back to Zod `safeParse` — correct in all cases, ~1.6× slower than the AJV path. Schemas that can't be expressed in JSON Schema (complex `.refine()`, custom predicates) fall back to `safeParse` automatically even when AJV is available.

AJV is configured `coerceTypes: false` and without `removeAdditional`, so the validator never silently mutates request data. Type coercion and unknown-key behaviour are determined entirely by your Zod schema.

---

## Hooks

Hooks are registered globally on the `Axiomify` instance and run on every request:

```typescript
app.addHook('onRequest', async (req, res) => {
  /* set X-Request-Id, auth, etc. */
});
app.addHook('onPreHandler', async (req, res, { route, params }) => {
  /* pre-handler logic */
});
app.addHook('onPostHandler', async (req, res, { route, params }) => {
  /* logging, metrics */
});
app.addHook('onError', async (err, req, res) => {
  /* custom error handling */
});
app.addHook('onClose', async (req, res) => {
  /* cleanup, always runs */
});
```

**Execution order on a matched route:** `onRequest` → router lookup → `onPreHandler` → compiled pipeline (validation steps + plugins + handler) → `onPostHandler` → `onClose`

When a handler or hook throws, `onError` runs in place of the remaining steps; `onClose` always runs in the `finally` branch, so cleanup is guaranteed even on error or abort.

### Hook performance

`HookManager.run()` is async-minimal:

- **Empty list** → returns `undefined` synchronously — no Promise allocation
- **Single handler** → called directly, no async wrapper
- **Multiple handlers** → sequential async loop

The `onPreHandler` step is only compiled into the route pipeline when at least one handler is registered. Routes without `onPreHandler` hooks skip that step entirely.

---

## Plugins

Plugins are per-route async functions that run before the handler:

```typescript
const requireAuth: RouteMiddleware = async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).send(null, 'Unauthorized');
  // if a plugin calls res.send(), the handler never runs
};

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth, rateLimiter], // run in order, stop if headersSent
  handler: async (req, res) => res.send(req.state.user),
});
```

If a plugin calls `res.send()` or sets `res.headersSent`, the remaining plugins and the handler are skipped.

---

## Route groups

Groups apply a shared prefix and/or shared plugins to a set of routes:

```typescript
app.group('/api/v1', { plugins: [requireAuth] }, (v1) => {
  v1.route({ method: 'GET', path: '/me', handler: ... });       // GET /api/v1/me + requireAuth

  v1.group('/admin', { plugins: [requireAdmin] }, (admin) => {
    admin.route({ method: 'DELETE', path: '/users/:id', handler: ... });
    // DELETE /api/v1/admin/users/:id + requireAuth + requireAdmin
  });
});
```

---

## Request object

```typescript
req.id; // string  — process-local counter ID, or upstream X-Request-Id
req.method; // HttpMethod
req.path; // string  — path only, no query string
req.url; // string  — full URL including query string
req.ip; // string  — client IP (respects trustProxy on the adapter)
req.headers; // Record<string, string | string[] | undefined>
req.body; // unknown — parsed JSON/urlencoded; Zod transforms applied if schema present
req.query; // Record<string, string | string[]> — multi-value keys are string[]
req.params; // Record<string, string> — named path parameters
req.state; // Record<string, unknown> — mutable per-request store for plugins
req.signal; // AbortSignal — aborted when client disconnects
req.stream; // Readable — raw request stream for multipart/upload
req.raw; // unknown — the underlying adapter-specific request object
```

`body`, `query`, and `params` are **writable** — the validation layer assigns the post-transform values back onto the request object.

---

## Response object

```typescript
res.status(201)                         // set HTTP status code (default 200)
res.header('X-Custom', 'value')         // set response header
res.send(data, message?)                // serialised envelope → { status, message, data }
res.sendRaw(payload, contentType?)      // bypass the serialiser
res.stream(readable, contentType?)      // stream a Readable to the client
res.sseInit(heartbeatMs?)               // start Server-Sent Events
res.sseSend(data, event?)               // send an SSE event
res.getHeader(key)                      // read a previously set header
res.removeHeader(key)                   // remove a previously set header
res.statusCode                          // read current status code
res.headersSent                         // true once send/sendRaw/stream called
res.raw                                 // adapter-specific response object
```

---

## Serialiser

The default serialiser wraps all `res.send(data, message?)` calls in an envelope:

```json
// 2xx — message defaults to "Operation successful"
{ "status": "success", "message": "Operation successful", "data": { /* data */ } }

// 4xx / 5xx — message defaults to "Error", overrideable via res.send(data, "...")
{ "status": "failed",  "message": "Error",                "data": null }
```

`isError` is `true` when `statusCode >= 400`. Replace globally — note the **single-argument** signature; the 4.x positional form (`(data, message, statusCode, isError, req) => ...`) was removed in 5.0 and now throws at adapter construction time:

```typescript
app.setSerializer(({ data, message, statusCode, isError, req }) => ({
  ok: !isError,
  requestId: req?.id,
  payload: data,
  ...(message ? { msg: message } : {}),
}));
```

The serializer MUST be synchronous. A serializer that returns a Promise throws at construction time — `JSON.stringify(Promise)` produces `[object Promise]` and would silently corrupt every response body.

`setSerializer` must be called before adapter construction. Once a `NativeAdapter` is built, the serializer is locked — the adapter has pre-built cached error envelopes (404 / 405 / 413 / 500) from the current serializer, and a late swap would produce inconsistent response shapes between fallbacks and live responses.

---

## X-Request-Id

`X-Request-Id` injection is **opt-in** in 5.0:

```typescript
const app = new Axiomify();
app.enableRequestId(); // hooks in the X-Request-Id injector
```

When enabled, every response gets an `X-Request-Id` header:

- The upstream `X-Request-Id` header value if a gateway forwarded one, **or**
- A process-local atomic counter ID (`<pid>-<counter>` in base-36).

The counter is module-level so two `Axiomify` instances in the same process don't produce colliding IDs. The cost is ~0.049µs per request vs `randomUUID()`'s ~0.137µs — meaningful at 50k req/s, free when the upstream header is already present.

> In 4.x this was always on. The default was changed to opt-in because every app — including those that never need request tracing — was paying the per-request closure allocation cost.

---

## Health checks

```typescript
app.healthCheck('/health', {
  database: async () =>
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  cache: async () =>
    redis
      .ping()
      .then(() => true)
      .catch(() => false),
});
// 200 { status: 'ok',      checks: { database: true, cache: true } }
// 503 { status: 'degraded', checks: { database: false, cache: true } }
```

---

## `listenClustered()`

`@axiomify/native` exposes `listenClustered()` for multi-core deployments. On Linux, workers bind the same port via `SO_REUSEPORT` and the kernel distributes connections — zero IPC in the request hot path. On macOS / Windows, `SO_REUSEPORT` is unavailable; clustering requires an explicit `allowUserspaceProxy: true` opt-in because the userspace L4 proxy fallback adds two event-loop hops per byte and defeats the perf rationale.

```typescript
const adapter = new NativeAdapter(app, {
  port: 3000,
  workers: 4,
  // allowUserspaceProxy: true,  // required on macOS / Windows
});
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary: (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

Crashed workers are restarted with exponential backoff (50 ms → 5 s cap). The primary process does not crash-loop terminate — orchestrators (Kubernetes / systemd) are expected to manage outer crash policy.

For the full unified shutdown story (`gracefulShutdown` waits for in-flight requests before exit), see [docs/packages/native.md](packages/native.md#graceful-shutdown).
