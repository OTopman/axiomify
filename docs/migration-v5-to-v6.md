# Migration guide — Axiomify v5 → v6

This guide covers every breaking change between v5.0.0 (production) and v6.0.0.
Run the automated codemod first, then work through the manual items below.

```bash
npx axiomify migrate   # applies all mechanical renames
npx axiomify check     # exits 1 on any remaining v5 patterns
```

---

## TL;DR

1. Replace `meta: { ... }` on route definitions with fields inside `schema:`
2. Remove `@axiomify/express`, `@axiomify/fastify`, `@axiomify/hapi`, `@axiomify/http`, `@axiomify/ws` — migrate to `@axiomify/native`
3. Replace `useOpenAPI({ routePrefix })` with `prefix:`
4. Remove `useSecurity({ sqlInjectionProtection })` — use parameterised queries
5. Replace `res.error(err)` with `res.status(err.statusCode ?? 500).send(null, err.message)`
6. Rename `RouteMeta` type annotations to `RouteSchema` (or drop them)
7. Fix any 5-arg serializers — they now throw at adapter construction (warned in v5)

---

## Breaking changes

### Adapters removed — `@axiomify/native` is the only adapter

| Removed package     | Replacement                              |
| ------------------- | ---------------------------------------- |
| `@axiomify/express` | `@axiomify/native`                       |
| `@axiomify/fastify` | `@axiomify/native`                       |
| `@axiomify/hapi`    | `@axiomify/native`                       |
| `@axiomify/http`    | `@axiomify/native`                       |
| `@axiomify/ws`      | `app.ws()` built into `@axiomify/native` |

```ts
// v5
import { ExpressAdapter } from '@axiomify/express';
const adapter = new ExpressAdapter(app, { port: 3000 });

// v6
import { NativeAdapter } from '@axiomify/native';
const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen((port) => console.log(`Running on ${port}`));
```

WebSocket routes — `@axiomify/ws` replaced by built-in `app.ws()`:

```ts
// v5 — @axiomify/ws (removed)
import { useWebSocket } from '@axiomify/ws';
useWebSocket(app, { path: '/chat' });

// v6 — built-in
app.ws({
  path: '/chat/:room',
  schema: {
    params: z.object({ room: z.string() }),
    message: z.object({ text: z.string() }),
  },
  handler: (ws) => {
    ws.on('message', (raw) => ws.send(raw));
  },
});
```

---

### `route.meta` removed — metadata moves into `schema`

In v5, route documentation metadata lived on a top-level `meta:` field
(type `RouteMeta`: `tags`, `summary`, `description`, `security`).
In v6 that field is gone — everything lives in `schema:` alongside Zod.
v6 also expands coverage from 4 fields to the full OAS 3.1.0 Operation Object.

```ts
// v5.0.0
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  meta: {
    tags: ['Users'],
    summary: 'Get user by id',
    description: 'Returns the public user profile.',
    security: [{ bearerAuth: [] }],
  },
  handler: async (req, res) => {
    /* ... */
  },
});

// v6.0.0
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: z.object({ id: z.string(), name: z.string() }),
    tags: ['Users'],
    summary: 'Get user by id',
    description: 'Returns the public user profile.',
    security: [{ bearerAuth: [] }],
    operationId: 'getUserById', // new in v6 — not in v5 RouteMeta
  },
  handler: async (req, res) => {
    /* ... */
  },
});
```

**Metadata fields — v5 vs v6:**

| Field                    | v5 `RouteMeta` | v6 `RouteSchema` | OAS §     |
| ------------------------ | -------------- | ---------------- | --------- |
| `tags`                   | ✅             | ✅               | 4.8.10.1  |
| `summary`                | ✅             | ✅               | 4.8.10.2  |
| `description`            | ✅             | ✅               | 4.8.10.3  |
| `security`               | ✅             | ✅               | 4.8.10.10 |
| `operationId`            | ❌             | ✅ new           | 4.8.10.5  |
| `deprecated`             | ❌             | ✅ new           | 4.8.10.9  |
| `externalDocs`           | ❌             | ✅ new           | 4.8.10.4  |
| `servers`                | ❌             | ✅ new           | 4.8.10.11 |
| `callbacks`              | ❌             | ✅ new           | 4.8.10.8  |
| `requestBodyDescription` | ❌             | ✅ new           | —         |
| `responseDescriptions`   | ❌             | ✅ new           | —         |

---

### `RouteMeta` type removed

```ts
// v5
import type { RouteMeta } from '@axiomify/core';
const meta: RouteMeta = { tags: ['Users'] };

// v6 — fields are part of RouteSchema; no separate type
import type { RouteSchema } from '@axiomify/core';
const partial: Pick<RouteSchema, 'tags' | 'summary'> = { tags: ['Users'] };
```

---

### OpenAPI spec 3.0.3 → 3.1.0

Generator emits `openapi: '3.1.0'` with JSON Schema 2020-12.
Optional fields use `type: ["string","null"]` instead of `nullable: true`.
Update tooling: Swagger UI 5.x, Redoc 2.x, openapi-typescript v7+.

---

### `useOpenAPI({ routePrefix })` removed

```ts
useOpenAPI(app, { info, routePrefix: '/docs' }); // v5 warned — now removed
useOpenAPI(app, { info, prefix: '/docs' }); // v6
```

---

### `useSecurity({ sqlInjectionProtection })` removed

```ts
useSecurity(app, { sqlInjectionProtection: true }); // v5 warned — now removed
useSecurity(app, {/* other valid options */}); // v6
const user = await db.query('SELECT * FROM users WHERE id = $1', [
  req.params.id,
]);
```

Exports `DEFAULT_SQL_PATTERNS` and `detectSqlInjection` also removed.

---

### `AxiomifyResponse.error()` removed

```ts
res.error(err); // v5 — removed
res.status(err.statusCode ?? 500).send(null, err.message); // v6
```

---

### `SerializerFn` 5-arg form now throws (warned in v5)

```ts
app.setSerializer((data, message, statusCode, isError, req) => ({ data })); // ❌ throws in v6
app.setSerializer(({ data, message, statusCode, isError }) => ({ data })); // ✅
```

---

### `AppPlugin` type removed

```ts
const plugin: AppPlugin = (app) => {}; // v5 @deprecated — removed in v6
const plugin: AppConfigurator = (app) => {}; // v6
```

---

### `@axiomify/auth` — secret check uses bytes, not chars

v5 checked `secret.length < 32`. v6 checks `Buffer.byteLength(secret, 'utf8') < 32`
per RFC 7518 §3.2. Generate a safe secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

---

### `@axiomify/logger` — `maskify-ts` removed

PII masking is now built-in (zero-dep). Remove if installed only for the logger:

```bash
npm uninstall maskify-ts reflect-metadata
```

---

## Automated migration

```bash
npx axiomify migrate --dry-run   # preview
npx axiomify migrate             # apply renames
npx axiomify check               # gate CI (exits 1 on remaining issues)
```

| Rule                 | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `meta-to-schema`     | Flags `meta: { ... }` with TODO comment for manual merge into `schema:` |
| `routePrefix-option` | `routePrefix:` → `prefix:` in `useOpenAPI()` calls                      |
| `RouteMeta-type`     | `RouteMeta` → `RouteSchema`                                             |
| `AppPlugin-type`     | `AppPlugin` → `AppConfigurator`                                         |

**Manual review required:** merging `meta:` into `schema:`, `res.error()` calls,
`sqlInjectionProtection` removal, adapter swap to `@axiomify/native`.

---

## Quick checklist

- [ ] `npm uninstall @axiomify/express @axiomify/fastify @axiomify/hapi @axiomify/http @axiomify/ws`
- [ ] `npm install @axiomify/native`
- [ ] Ran `npx axiomify migrate`
- [ ] Moved all `meta: { ... }` fields into `schema:` and deleted `meta:`
- [ ] `useOpenAPI({ routePrefix })` → `prefix:`
- [ ] Removed `sqlInjectionProtection` from `useSecurity()`
- [ ] Replaced `res.error(err)` calls
- [ ] Fixed 5-arg `setSerializer()` calls
- [ ] Updated OpenAPI tooling to accept OAS 3.1.0
- [ ] JWT secrets are ≥ 32 **bytes** (not just chars)
- [ ] Removed `maskify-ts` / `reflect-metadata` if installed for the logger
- [ ] `npx axiomify check` exits 0
- [ ] `npm test` is green
