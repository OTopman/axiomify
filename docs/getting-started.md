# Getting Started with Axiomify

## Prerequisites

- Node.js **18, 20, 21, or 22** (uWebSockets.js pre-built binaries; Node 23+ not yet supported by uWS)
- TypeScript 5+ (the workspace itself uses TypeScript 6.x; either works for consumers)

## Create a project

```bash
npx @axiomify/cli init my-api
cd my-api
npm install
npm run dev
```

The CLI scaffolds a TypeScript project, copies a starter `src/index.ts`, and installs `@axiomify/core` + `@axiomify/native` + `zod`. After `npm install`, `npm run dev` boots the dev server with auto-reload.

## Manual setup

```bash
npm install @axiomify/core @axiomify/native zod
```

**`src/index.ts`:**

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({
      email: z.string().email(),
      name: z.string().min(2),
    }),
  },
  handler: async (req, res) => {
    const { email, name } = req.body;
    res.status(201).send({ id: 'usr_1', email, name });
  },
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => {
  console.log('Listening on :3000');
});
```

## Response envelope

Every `res.send(data, message?)` call is wrapped by the default serializer:

```json
// 2xx response — message defaults to "Operation successful"
{ "status": "success", "message": "Operation successful", "data": { /* your data */ } }

// 4xx / 5xx response — message defaults to "Error", overrideable via res.send(data, "Custom message")
{ "status": "failed",  "message": "Error",                "data": null }
```

Replace the wrapper with `app.setSerializer(({ data, message, statusCode, isError, req }) => ...)`. The serializer must be synchronous — async serializers throw at adapter construction time (they'd corrupt response bodies via `JSON.stringify([object Promise])`).

## Validation

Zod schemas in `schema.body`, `schema.params`, and `schema.query` are converted to JSON Schema 2020-12 at startup and compiled by AJV (or fall back to Zod `safeParse` if AJV is unavailable — ~1.6× slower but always correct). Invalid requests receive 400 with field-level errors before the handler runs.

When a Zod schema declares `.transform()`, validation runs a second pass through `schema.parse()` so transforms apply. Schemas without transforms run only the AJV compiled function.

---

## What you get out of the box from `@axiomify/cli`

After `npm run dev` is working, four other CLI commands are immediately useful:

```bash
# 1. Visualise every registered route + WebSocket endpoint.
npx axiomify routes

# 2. Generate the OpenAPI spec for client codegen (openapi-typescript, etc).
npx axiomify openapi -o openapi.json

# 3. Static production-readiness audit — catches missing env vars,
#    deprecated meta fields, missing health checks, unprotected docs, etc.
#    Exit 1 on any fail — wire into CI to gate deploys.
npx axiomify check

# 4. Diagnose the host environment (Node version, uWS bindings, port
#    availability, dep drift). Run on a fresh clone or new CI runner.
npx axiomify doctor
```

For the routes / openapi / check commands, the entry file MUST export your `Axiomify` instance:

```typescript
// Named export — preferred
export const app = new Axiomify();
// ...

// Guard the listener so CLI inspection doesn't boot a real server:
if (require.main === module) {
  new NativeAdapter(app, { port: 3000 }).listen();
}
```

Full CLI reference: [docs/packages/cli.md](./packages/cli.md) — including
`routes --snapshot` / `--diff` (breaking-change CI gates), `openapi --validate`
and `axiomify db`.

## Testing your routes

`@axiomify/testing` dispatches requests through the framework without opening
a socket — no adapter, no port:

```typescript
import { createTestClient } from '@axiomify/testing';
import { app } from '../src/index';

const client = createTestClient(app);
const res = await client.post('/users', { body: { name: 'Ada' } });
// res.statusCode, res.json(), res.cookies — production-identical envelopes
```

See [docs/packages/testing.md](./packages/testing.md).

## Common next steps

| Need | Package |
| ---- | ------- |
| Sessions & sign-in flows | [`@axiomify/session`](./packages/session.md), [`@axiomify/auth`](./packages/auth.md) (JWT/JWKS, API keys, OAuth + PKCE) |
| Smaller & faster responses | [`@axiomify/compress`](./packages/compress.md), [`@axiomify/cache`](./packages/cache.md) |
| A database | [`@axiomify/db`](./packages/db.md) (Prisma, Drizzle, pg, mysql2, better-sqlite3) |
| Real-time across workers | [`@axiomify/ws`](./packages/ws.md) with a `WsBroker` |
| HTTP/2 | [`Http2Adapter`](./packages/native.md) in `@axiomify/native` |

---

- [Plugins and Hooks](./plugins-and-hooks.md)
- [Production Checklist](./production-checklist.md)
