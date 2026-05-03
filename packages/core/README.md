# @axiomify/core

The routing engine, AJV-compiled validation, hook manager, and dispatcher at the heart of Axiomify.

## Install

```bash
npm install @axiomify/core zod
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: '1', name: req.body.name });
  },
});
```

Pair with an adapter to serve HTTP:

```typescript
import { FastifyAdapter } from '@axiomify/fastify';
new FastifyAdapter(app).listen(3000);

// or: ExpressAdapter, HapiAdapter, HttpAdapter, NativeAdapter
```

## Route definition

```typescript
app.route({
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD',
  path: '/path/:param',        // Axiomify :param syntax (adapters convert as needed)
  schema: {                    // all fields optional
    params:   z.object({ ... }),
    query:    z.object({ ... }),
    body:     z.object({ ... }),
    response: z.object({ ... }) | { 200: z.object(...), 404: z.object(...) },
    files:    { fieldName: { maxSize, allowedTypes } },
    tags:     ['Users'],           // for OpenAPI
    description: 'Route description',
    security: [{ bearerAuth: [] }],
  },
  plugins: [requireAuth, rateLimiter],  // run before handler, in order
  timeout: 5000,               // ms — overrides global timeout, 0 = disabled
  handler: async (req, res) => { ... },
});
```

## AJV-compiled validation

Zod schemas are converted to JSON Schema 2020-12 via `z.toJSONSchema()` at startup, then compiled by AJV. At runtime:

| Path | Cost |
|---|---|
| Valid input | ~0.06µs (AJV compiled) |
| Invalid input | ~0.12µs (AJV error collection) |
| Zod safeParse valid | ~0.30µs |
| Zod safeParse invalid | ~49.75µs |

Zod transforms (`.default()`, `.coerce.*`, `.transform()`) are applied via `schema.parse()` after AJV validates structure — transforms always run.

## Hooks

```typescript
app.addHook('onRequest',     (req, res) => { /* before routing */ });
app.addHook('onPreHandler',  (req, res, match) => { /* route matched, before validation */ });
app.addHook('onPostHandler', (req, res, match) => { /* after handler responded */ });
app.addHook('onError',       (err, req, res) => { /* handler/hook threw */ });
app.addHook('onClose',       (req, res) => { /* always last */ });
```

Hook execution order: `onRequest` → `onPreHandler` → handler → `onPostHandler` → `onClose`.

`onError` fires instead of `onPostHandler` when the handler throws. `onClose` fires in both cases.

Hooks are async-minimal: `HookManager.run()` returns synchronously for empty lists, calls single handlers without an async wrapper — no microtask boundary for routes that don't use a hook type.

## Route groups

```typescript
app.group('/api/v1', { plugins: [requireAuth] }, (v1) => {
  v1.route({ method: 'GET', path: '/me', handler: async (req, res) => res.send(req.state.authUser) });

  v1.group('/admin', { plugins: [requireAdmin] }, (admin) => {
    admin.route({ method: 'DELETE', path: '/users/:id', handler: deleteUser });
  });
});
// Results in: GET /api/v1/me, DELETE /api/v1/admin/users/:id
// Both inherit requireAuth; DELETE also has requireAdmin
```

## Response API

```typescript
res.status(201)                        // set status code (default 200)
res.header('X-Custom', 'value')        // set response header
res.send(data, message?)               // serialised envelope { status, message, data }
res.sendRaw(payload, contentType?)     // bypass serialiser
res.stream(readable, contentType?)     // stream a Readable
res.sseInit(heartbeatMs?)              // Server-Sent Events (not on @axiomify/native)
res.sseSend(data, event?)              // send SSE event
res.error(err)                         // send 500 with error message
```

## Custom serialiser

```typescript
app.setSerializer((data, message, statusCode, isError, req) => ({
  ok: !isError,
  requestId: req?.id,
  payload: data,
  ...(message ? { message } : {}),
}));
```

## Health checks

```typescript
app.healthCheck('/health', {
  database: async () => db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  cache:    async () => redis.ping().then(() => true).catch(() => false),
});
// GET /health → 200 { status: 'ok', checks: { database: true, cache: true } }
// Any check false → 503 { status: 'degraded', checks: { database: false, ... } }
```

## Router

The radix-trie router uses character-by-character path walking with a pre-allocated flat param accumulator — no `split('/')` allocation per lookup, no spread per matched segment. Lookup is O(k) where k = path depth.

In adapters, the router is never called twice: each adapter registers routes with its own framework's router (Express's, Fastify's, Hapi's, uWS's). Axiomify's router is consulted only in the 404/405 fallback.
