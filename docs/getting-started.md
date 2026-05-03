# Getting Started with Axiomify

## Prerequisites

- Node.js 18, 20, or 22
- TypeScript 5+

## Create a project

```bash
npx axiomify init my-api
cd my-api
npm run dev
```

The CLI prompts for adapter, package manager, ESLint, and git — Fastify is the recommended default.

## Manual setup

```bash
npm install @axiomify/core @axiomify/fastify zod
```

**`src/index.ts`:**

```typescript
import { Axiomify } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';
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
      name:  z.string().min(2),
    }),
  },
  handler: async (req, res) => {
    const { email, name } = req.body;
    res.status(201).send({ id: 'usr_1', email, name });
  },
});

const adapter = new FastifyAdapter(app);
await adapter.listen(3000);
console.log('Listening on :3000');
```

## Response envelope

Every response is wrapped:

```json
{ "status": "success", "message": "Operation successful", "data": { ... } }
{ "status": "failed",  "message": "Validation failed",    "data": null }
```

## Validation

Zod schemas in `schema.body`, `schema.params`, and `schema.query` are compiled to AJV validators at startup. Invalid requests receive 400 with field-level errors before the handler runs.

## Choosing an adapter

| Need | Adapter |
|---|---|
| Maximum throughput, new project | `@axiomify/native` |
| High throughput + Fastify plugins | `@axiomify/fastify` |
| Express middleware ecosystem | `@axiomify/express` |
| Hapi plugin ecosystem | `@axiomify/hapi` |
| Edge / serverless / minimal | `@axiomify/http` |

All adapters are interchangeable — swap without changing any handler.

## Next steps

- [Plugins and Hooks](./plugins-and-hooks.md)
- [Adapters](./adapters.md)
- [Production Checklist](./production-checklist.md)
