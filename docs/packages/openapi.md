# @axiomify/openapi

Auto-generates OpenAPI 3.0 from Axiomify routes and Zod schemas. Uses Zod v4's built-in `z.toJSONSchema()` — no third-party bridge needed.

## API

- `useSwagger(app, options)` — mounts Swagger UI at `routePrefix` and spec at `routePrefix/openapi.json`
- `new OpenApiGenerator(app, options).generate()` — generate raw spec object

## Route schema extensions

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
    tags: ['Users'],
    description: 'Get user by ID',
    security: [{ bearerAuth: [] }], // per-route security
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
    },
  },
  security: [{ bearerAuth: [] }],
});
```

## Production access control

```typescript
useSwagger(app, {
  info: { title: 'My API', version: '1.0.0' },
  protect: (req) => {
    // Only allow internal network
    return req.ip.startsWith('10.') || req.ip === '127.0.0.1';
  },
});
```
