# @axiomify/openapi

Auto-generates OpenAPI 3.0 specs from Axiomify routes and Zod schemas. Uses Zod v4's built-in
`z.toJSONSchema()` — no third-party schema bridge required.

## Install

```bash
npm install @axiomify/openapi
```

## Quick start

```typescript
import { useSwagger } from '@axiomify/openapi';

useSwagger(app, {
  routePrefix: '/docs',         // Swagger UI at /docs, spec at /docs/openapi.json
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'API powered by Axiomify',
  },
});
```

Swagger UI is served at `/docs`. The raw JSON spec is at `/docs/openapi.json`.

## API

| Export | Description |
|---|---|
| `useSwagger(app, options)` | Mount Swagger UI + spec endpoint on the app |
| `new OpenApiGenerator(app, options).generate()` | Generate raw spec as a plain object |
| `defineSecuritySchemes(schemes)` | Type helper for security scheme definitions |

## Route schema extensions

All schema fields are optional. Only provide what you want to document.

```typescript
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params:      z.object({ id: z.string().uuid() }),
    query:       z.object({ include: z.string().optional() }),
    response: {
      200: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      404: z.object({ message: z.string() }),
    },
    tags:        ['Users'],
    description: 'Get a user by ID',
    security:    [{ bearerAuth: [] }],  // per-route security override
  },
  handler: async (req, res) => { /* ... */ },
});
```

## Global security schemes

```typescript
useSwagger(app, {
  info: { title: 'My API', version: '1.0.0' },

  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey:     { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },

  // Apply bearerAuth to ALL routes by default
  security: [{ bearerAuth: [] }],
});
```

## Protecting the docs in production

```typescript
useSwagger(app, {
  info: { title: 'Internal API', version: '1.0.0' },
  protect: (req) => {
    // Only allow access with an internal token
    return req.headers['x-internal-key'] === process.env.DOCS_KEY;
  },
  // Or disable entirely in production
  allowPublicInProduction: false, // default
});
```

## Path parameter syntax

Axiomify uses `:param` syntax. The generator converts to OpenAPI `{param}` automatically:

| Axiomify path | OpenAPI path |
|---|---|
| `/users/:id` | `/users/{id}` |
| `/users/:userId/posts/:postId` | `/users/{userId}/posts/{postId}` |

## File upload routes

```typescript
app.route({
  method: 'POST',
  path: '/avatar',
  schema: {
    files: {
      avatar: { maxSize: 5 * 1024 * 1024, description: 'Profile image (max 5MB)' },
    },
  },
  handler: async (req, res) => { /* ... */ },
});
// Generates: Content-Type: multipart/form-data with avatar as binary field
```

## Zod v4 compatibility

The generator uses `z.toJSONSchema()` (built into Zod v4) to convert schemas to JSON Schema
2020-12. This produces correct, non-empty `properties` for all standard Zod types:

- `z.string()`, `z.number()`, `z.boolean()`, `z.array()`, `z.object()` → correct types
- `z.enum()` → `enum` field
- `z.union()` → `oneOf`
- `z.optional()` → excluded from `required`

For Zod v3 (if installed), falls back to `zod-to-json-schema` automatically.
