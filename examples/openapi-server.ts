// examples/openapi-server.ts
import { Axiomify, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { useOpenAPI } from '@axiomify/openapi';

const app = new Axiomify();

// 1. Define Routes
app.route({
  method: 'POST',
  path: '/api/v1/users',
  schema: {
    body: z.object({
      username: z
        .string()
        .min(3)
        .openapi({ description: 'The unique username' }),
      age: z.number().min(18),
    }),
    response: z.object({
      id: z.string().uuid(),
      username: z.string(),
    }),
  },
  handler: async (req, res) => {
    // req.body is strongly typed, validated, and automatically documented!
    res
      .status(201)
      .send({ id: crypto.randomUUID(), username: req.body.username });
  },
});

// 2. Inject the OpenAPI System
useOpenAPI(app, {
  routePrefix: '/docs',
  info: {
    title: 'Axiomify Production API',
    version: '1.0.0',
    description: 'Auto-generated high-performance API documentation',
  },
});

// 3. Start Server
const adapter = new ExpressAdapter(app);
adapter.listen(3000, () => {
  console.log('🚀 API Engine running');
  console.log('📚 Swagger UI available at http://localhost:3000/docs');
});
