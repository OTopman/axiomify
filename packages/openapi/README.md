# @axiomify/openapi

[![npm version](https://img.shields.io/npm/v/@axiomify/openapi.svg)](https://npmjs.com/package/@axiomify/openapi)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Auto-generates OpenAPI 3.1.0 documentation from your Axiomify routes and Zod schemas. Supports Zod v4 natively via `z.toJSONSchema()`.

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
    // Zod validation
    body: z.object({ email: z.string().email(), name: z.string() }),
    response: z.object({ id: z.string(), email: z.string(), name: z.string() }),
    // OpenAPI 3.1.0 metadata — same block, no separate `openapi:` property
    tags: ['Users'],
    summary: 'Create a new user',
    operationId: 'createUser',
  },
  handler: async (req, res) =>
    res.status(201).send({ id: 'usr_1', ...req.body }),
});

useOpenAPI(app, {
  info: { title: 'My API', version: '1.0.0' },
  prefix: '/docs', // UI at /docs  ·  spec at /docs/openapi.json
  protect: (req) => req.headers['x-internal-token'] === process.env.DOCS_TOKEN,
});
```

## Hiding internal endpoints

Routes are included in the generated specification by default. Set
`schema.openapi` to `false` to omit an internal endpoint from both
`openapi.json` and Swagger UI. `openapi: true` explicitly includes a route.

```typescript
app.route({
  method: 'GET',
  path: '/internal/health',
  schema: { openapi: false },
  handler: async (_req, res) => res.send({ ok: true }),
});
```

## Zod transforms and diagnostics

OpenAPI describes the API input/output contract, not arbitrary runtime code.
When a Zod schema uses `.transform()` or another unrepresentable feature,
Axiomify exports the input-side shape, widens only the unrepresentable part,
and adds an `x-axiomify-warnings` entry instead of failing generation. Run
`axiomify openapi --validate` in CI to surface these warnings and configuration
mistakes such as `components.securitySchemas` (the correct property is
`components.securitySchemes`).

## Production access (secure by default)

The docs UI and `openapi.json` spec are **denied in production by default**. When `NODE_ENV=production` and no `protect` callback is provided, requests are refused (and a warning is logged at startup). To expose docs in production you must opt in explicitly with one of:

- `protect: (req) => boolean | Promise<boolean>` — gate access with your own check (recommended for internal/non-public APIs), or
- `allowPublicInProduction: true` — serve the docs publicly in production (use only for genuinely public APIs).

In non-production environments the docs are served without gating.

```typescript
useOpenAPI(app, {
  info: { title: 'My API', version: '1.0.0' },
  protect: (req) => req.headers['x-internal-token'] === process.env.DOCS_TOKEN,
  // or: allowPublicInProduction: true,
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
  security: [{ bearerAuth: [] }], // applied globally to all routes
});

// Per-route override — empty security array opts out of global security (OAS §4.8.10.10)
app.route({
  method: 'GET',
  path: '/public',
  schema: { security: [] },
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
    if (!user) return res.status(404).send({ message: 'Not Found' });
    res.send(user);
  },
});
```
