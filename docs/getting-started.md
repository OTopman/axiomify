# Getting Started

## Install

Pick the core plus one adapter:

```bash
npm install @axiomify/core @axiomify/fastify zod
```

You can swap `@axiomify/fastify` for `@axiomify/express`, `@axiomify/hapi`, or `@axiomify/http`.

## Minimal App

```ts
import { Axiomify, z } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';

export const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({
      email: z.string().email(),
      name: z.string().min(2),
    }),
    response: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
    }),
  },
  handler: async (req, res) => {
    res.status(201).send({
      id: 'user-1',
      email: req.body.email,
      name: req.body.name,
    });
  },
});

if (require.main === module) {
  const adapter = new FastifyAdapter(app);
  adapter.listen(3000, () => {
    console.log('Axiomify running on http://localhost:3000');
  });
}
```

## Add Cross-Cutting Behavior

Global behavior is usually installed with package helpers:

```ts
import { useCors } from '@axiomify/cors';
import { useHelmet } from '@axiomify/helmet';

useCors(app, { origin: ['https://app.example.com'] });
useHelmet(app);
```

Route-specific behavior is passed directly as functions:

```ts
import { createAuthPlugin } from '@axiomify/auth';

const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });

app.route({
  method: 'GET',
  path: '/me',
  plugins: [requireAuth],
  handler: async (req, res) => {
    res.send({ id: req.user?.id });
  },
});
```

## Next Steps

- Read [Core Concepts](./core-concepts.md)
- Pick an adapter from [Adapters](./adapters.md)
- Browse package pages in [Packages Index](./packages/README.md)
