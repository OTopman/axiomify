# @axiomify/hapi

Hapi.js adapter for Axiomify. Uses Hapi's router with `{param}` path syntax — no double routing.

## Install

```bash
npm install @axiomify/hapi @axiomify/core @hapi/hapi zod
npm install --save-dev @types/hapi__hapi
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { HapiAdapter } from '@axiomify/hapi';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: '1', ...req.body });
  },
});

const adapter = new HapiAdapter(app);
await adapter.listen(3000);
console.log('Hapi on :3000');
```

## Options

Pass any `Hapi.ServerOptions` directly:

```typescript
new HapiAdapter(app, {
  routes: {
    payload: {
      maxBytes: 1_048_576,  // 1 MB body limit
    },
  },
  host: '0.0.0.0',
});
```

## Path conversion

Axiomify uses `:param` syntax. The adapter converts to Hapi's `{param}` syntax at startup — zero overhead per request:

| Axiomify | Hapi |
|---|---|
| `/users/:id` | `/users/{id}` |
| `/users/:userId/posts/:postId` | `/users/{userId}/posts/{postId}` |
| `/files/*` | `/files/{wild*}` |

## Body parsing

Hapi receives bodies as raw streams (`parse: false, output: 'stream'`). The adapter stream-parses `application/json` and `application/x-www-form-urlencoded` bodies internally. `multipart/form-data` is left as a raw stream for `@axiomify/upload` to process via Busboy.

## Routing

Each Axiomify route is registered with Hapi's router using the converted path syntax. Hapi resolves the route and populates `req.params` before the handler runs. Axiomify's router is consulted **only** in the `method: '*'` catch-all to distinguish 404 from 405.

## When to use @axiomify/hapi

- Existing Hapi plugin ecosystem (`@hapi/jwt`, `@hapi/vision`, etc.)
- Configuration-driven architecture requirements
- Enterprise teams already standardised on Hapi

For new projects, prefer `@axiomify/fastify` or `@axiomify/native` for higher throughput.
