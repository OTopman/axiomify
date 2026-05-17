# @axiomify/openapi

Auto-generates OpenAPI 3.0 specs from Axiomify routes and Zod schemas. Uses Zod v4's built-in
`z.toJSONSchema()` — no third-party schema bridge required.

## Install

```bash
npm install @axiomify/openapi
```

## Quick start

```typescript
import { useOpenAPI } from '@axiomify/openapi';

useOpenAPI(app, {
  prefix: '/docs',              // Swagger UI at /docs, spec at /docs/openapi.json
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
| `useOpenAPI(app, options)` | Mount Swagger UI + spec endpoint on the app |
| `new OpenApiGenerator(app, options).generate()` | Generate raw spec as a plain object |
| `defineSecuritySchemes(schemes)` | Type helper for security scheme definitions |

## Route metadata — the `openapi` field

The `openapi` field on a route definition mirrors the
[OpenAPI 3.0.3 Operation Object](https://spec.openapis.org/oas/v3.0.3#operation-object)
**verbatim**. Every Operation Object property is supported. Authors who know
the spec can paste fragments directly from swagger.io — no wrapper, no
translation table, no Axiomify-specific shape to learn.

The framework derives three Operation Object properties from your
`schema:` block, so they're NOT supplied on `openapi`:

- `parameters` ← derived from `schema.params` + `schema.query`
- `requestBody` ← derived from `schema.body` + `schema.files`
- `responses` ← derived from `schema.response`

Everything else lives on `openapi`:

```typescript
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().uuid() }),
    query:  z.object({ include: z.string().optional() }),
    response: {
      200: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  openapi: {
    tags:        ['Users'],
    summary:     'Get user by id',
    description: 'Returns the public profile of the user identified by `:id`.',
    operationId: 'getUserById',           // for client codegen
    security:    [{ bearerAuth: [] }],    // per-route security override
    responseDescriptions: {
      '200': 'User profile',
      '404': 'No user with the supplied id',
    },
  },
  handler: async (req, res) => { /* ... */ },
});
```

### All supported `openapi` fields

Spec-matching properties (every OAS 3.0.3 Operation Object field minus the
three the framework derives):

| Field | Type | OAS § | Purpose |
|---|---|---|---|
| `tags` | `string[]` | 4.7.10.1 | Grouping label(s); Swagger groups by tag. |
| `summary` | `string` | 4.7.10.2 | Short one-line title. Defaults to `${method} ${path}`. |
| `description` | `string` | 4.7.10.3 | Long-form CommonMark description below the summary. |
| `externalDocs` | `{ url, description? }` | 4.7.10.4 | "Find more" link rendered under the description. |
| `operationId` | `string` | 4.7.10.5 | Identifier for client codegen. Auto-synthesised from method+path when omitted (e.g. `getUsersById`). |
| `deprecated` | `boolean` | 4.7.10.9 | Marks the operation deprecated in the docs UI. |
| `security` | `Array<Record<string, string[]>>` | 4.7.10.10 | Per-route security. `[]` opts out of global security. |
| `servers` | `OpenApiServer[]` | 4.7.10.11 | Per-operation server overrides. Use when one endpoint lives at a different host than the rest of the API. |
| `callbacks` | `Record<string, unknown>` | 4.7.10.8 | Async webhook callbacks. Passed through verbatim; the spec for the nested shape is in [OAS §4.7.18](https://spec.openapis.org/oas/v3.0.3#callback-object). |

Axiomify-specific helpers (override descriptions the generator would
otherwise synthesise for schema-derived sections):

| Field | Type | Purpose |
|---|---|---|
| `requestBodyDescription` | `string` | Override the auto-generated requestBody description. |
| `responseDescriptions` | `Record<string, string>` | Per-status-code response description map. Overrides the generator default (`Successful response` / `Response 4xx`). |

### Marking an endpoint deprecated

```typescript
app.route({
  method: 'GET', path: '/v1/users/:id',
  openapi: {
    tags: ['Users'],
    deprecated: true,
    description: 'Use `/v2/users/:id` instead.',
    externalDocs: {
      url: 'https://docs.example.com/migration/v1-to-v2',
      description: 'Migration guide',
    },
  },
  handler: legacyHandler,
});
```

### Per-operation server overrides

Use when a single endpoint lives at a different host than the rest of the
API — for example, a CDN-hosted upload endpoint or a regional billing
service called from an otherwise-global API.

```typescript
app.route({
  method: 'POST', path: '/uploads',
  openapi: {
    servers: [
      { url: 'https://uploads.example.com', description: 'Upload edge' },
    ],
  },
  handler: uploadHandler,
});
```

### Async callbacks (webhooks)

The `callbacks` field is passed to the generated spec without
transformation — the nesting depth matches the OAS Callback Object
verbatim. Authors are responsible for the shape inside.

```typescript
app.route({
  method: 'POST', path: '/jobs',
  openapi: {
    callbacks: {
      jobComplete: {
        '{$request.body#/callbackUrl}': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '200': { description: 'callback acknowledged' } },
          },
        },
      },
    },
  },
  handler: enqueueJob,
});
```

### Migrating from `meta:` (4.x → 5.x)

In 4.x the field was named `meta`. The 5.0.0 rename to `openapi` matches
the OAS spec terminology and lets you paste spec fragments directly. Both
names work through the 5.x line; `meta` is removed in 6.0.

```typescript
// 4.x
meta: { tags: ['Users'], operationId: 'getUserById' }

// 5.0+
openapi: { tags: ['Users'], operationId: 'getUserById' }
```

If you supply both, `openapi` wins — the generator does NOT merge.

## Global security schemes

```typescript
useOpenAPI(app, {
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
useOpenAPI(app, {
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
