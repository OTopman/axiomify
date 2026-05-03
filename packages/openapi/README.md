# @axiomify/openapi

Auto-generates OpenAPI 3.0 documentation from your Axiomify routes and Zod schemas. Supports Zod v4 natively via `z.toJSONSchema()`.

## Install

```bash
npm install @axiomify/openapi
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { useOpenAPI } from '@axiomify/openapi';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ email: z.string().email(), name: z.string() }),
    response: z.object({ id: z.string(), email: z.string(), name: z.string() }),
    tags: ['Users'],
    description: 'Create a new user',
  },
  handler: async (req, res) => res.status(201).send({ id: 'usr_1', ...req.body }),
});

useOpenAPI(app, {
  info: { title: 'My API', version: '1.0.0' },
  routePrefix: '/docs',          // UI at /docs, spec at /docs/openapi.json
  protect: (req) => req.headers['x-internal-token'] === process.env.DOCS_TOKEN,
});
```

## Security schemes

```typescript
useOpenAPI(app, {
  info: { title: 'My API', version: '1.0.0' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],  // applied globally
});

// Per-route override
app.route({
  method: 'GET',
  path: '/public',
  schema: { security: [] }, // opt out of global security for this route
  handler: async (_req, res) => res.send({ public: true }),
});
```

## Multiple response schemas

```typescript
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: {
      200: z.object({ id: z.string(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: async (req, res) => {
    const user = await db.users.findById(req.params.id);
    if (!user) return res.status(404).send(null, 'Not Found');
    res.send(user);
  },
});
```
