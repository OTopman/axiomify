# Core Concepts

## How Axiomify works

Axiomify separates three concerns that most frameworks conflate:

1. **Schema** — Zod, the single source of truth for runtime validation, TypeScript types, and OpenAPI specs
2. **Pipeline** — hooks + plugins + handler, composed at route registration time
3. **Transport** — the adapter (Express, Fastify, Hapi, uWS, Node HTTP) handles TCP and protocol details

You write routes once. The adapter is swappable with zero route changes.

---

## Routing

Routes are registered on `Axiomify` and compiled into a radix trie at startup:

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

**No double routing.** Every adapter (Express, Fastify, Hapi, uWS, Node HTTP) registers routes with its own framework's router and calls `handleMatchedRoute()` directly. Axiomify's internal router is consulted at most once per request — only in the 404/405 fallback to distinguish the two cases.

The radix trie uses **character-by-character path walking** with a pre-allocated flat param accumulator — no `split('/')` allocation per lookup, no spread per matched segment. Lookup is O(k) where k = path depth.

---

## Validation — Fastify-grade AJV compilation

Zod schemas are not evaluated at request time. At route registration:

1. `z.toJSONSchema(schema)` converts the Zod schema to JSON Schema 2020-12 (Zod v4 built-in)
2. `AJV.compile(jsonSchema)` produces a compiled validator function
3. The compiled function is stored on the route — no schema introspection at request time

At request time:
- **AJV validates structure** — ~0.06µs on the valid path, ~0.12µs on invalid
- **`schema.parse(data)` applies Zod transforms** on the valid path — `.default()`, `.coerce.*`, `.transform()` all work correctly

Compare to Zod `safeParse` alone: ~0.30µs valid, ~49.75µs invalid. **428× faster on the error path.**

Schemas that cannot be expressed in JSON Schema (complex `.refine()`) fall back to Zod `safeParse` automatically.

---

## Hooks

Hooks are registered globally on the `Axiomify` instance and run on every request:

```typescript
app.addHook('onRequest',     async (req, res) => { /* set X-Request-Id, auth, etc. */ });
app.addHook('onPreHandler',  async (req, res, { route, params }) => { /* pre-handler logic */ });
app.addHook('onPostHandler', async (req, res, { route, params }) => { /* logging, metrics */ });
app.addHook('onError',       async (err, req, res) => { /* custom error handling */ });
app.addHook('onClose',       async (req, res) => { /* cleanup, always runs */ });
```

**Execution order:** `onRequest` → plugins → validation → handler → `onPostHandler` → `onClose`

When an error is thrown: `onError` replaces `onPostHandler`, then `onClose` still runs.

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
const requireAuth: PluginHandler = async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).send(null, 'Unauthorized');
  // if a plugin calls res.send(), the handler never runs
};

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth, rateLimiter], // run in order, stop if headersSent
  handler: async (req, res) => res.send(req.state.authUser),
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
req.id       // string  — process-local counter ID, or upstream X-Request-Id
req.method   // HttpMethod
req.path     // string  — path only, no query string
req.url      // string  — full URL including query string
req.ip       // string  — client IP (respects trustProxy on the adapter)
req.headers  // Record<string, string | string[] | undefined>
req.body     // unknown — parsed JSON/urlencoded; Zod transforms applied if schema present
req.query    // Record<string, string | string[]> — multi-value keys are string[]
req.params   // Record<string, string> — named path parameters
req.state    // Record<string, unknown> — mutable per-request store for plugins
req.signal   // AbortSignal — aborted when client disconnects
req.stream   // Readable — raw request stream for multipart/upload
req.raw      // unknown — the underlying adapter-specific request object
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
res.sseInit(heartbeatMs?)               // start Server-Sent Events (not on @axiomify/native)
res.sseSend(data, event?)               // send an SSE event
res.error(err)                          // send 500 with err.message
res.getHeader(key)                      // read a previously set header
res.removeHeader(key)                   // remove a previously set header
res.statusCode                          // read current status code
res.headersSent                         // true once send/sendRaw/stream called
res.raw                                 // adapter-specific response object
```

---

## Serialiser

The default serialiser wraps all `res.send(data)` calls in an envelope:

```json
{ "status": "success", "message": "Operation successful", "data": { ... } }
{ "status": "failed",  "message": "Validation failed",    "data": null }
```

`isError` is `true` when `statusCode >= 400`. Replace globally:

```typescript
app.setSerializer((data, message, statusCode, isError, req) => ({
  ok: !isError,
  requestId: req?.id,
  payload: data,
  ...(message ? { msg: message } : {}),
}));
```

---

## X-Request-Id

Every response gets an `X-Request-Id` header via the built-in `onRequest` hook. The ID is:
- The upstream `X-Request-Id` header value (when a gateway injects it), **or**
- A process-local atomic counter ID (`<pid>-<counter>` in base-36)

The counter approach costs ~0.049µs vs `randomUUID()`'s ~0.137µs — meaningful at 50k req/s.

---

## Health checks

```typescript
app.healthCheck('/health', {
  database: async () => db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  cache:    async () => redis.ping().then(() => true).catch(() => false),
});
// 200 { status: 'ok',      checks: { database: true, cache: true } }
// 503 { status: 'degraded', checks: { database: false, cache: true } }
```

---

## Adapters and `listenClustered()`

All adapters expose `listenClustered()` for multi-core deployments. Workers bind the same port via the OS; connections are distributed by the kernel.

```typescript
// Native — SO_REUSEPORT (kernel load-balancing, zero IPC)
const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });
adapter.listenClustered({ onWorkerReady: () => console.log(`[${process.pid}] ready`) });

// Express / Fastify / Hapi / HTTP — Node.js cluster (round-robin)
const adapter = new FastifyAdapter(app, { workers: 4 });
adapter.listenClustered(3000, { onWorkerReady: (port) => console.log(`[:${port}] ready`) });
```

Crashed workers are automatically restarted in all cases.
