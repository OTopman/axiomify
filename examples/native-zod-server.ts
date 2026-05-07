/**
 * Minimal example: Axiomify + @axiomify/http with Zod validation.
 *
 * Demonstrates the transform-aware validator fast path (v5):
 * - z.string().min(2)      → no transforms → AJV only, Zod skipped
 * - z.number().positive()  → no transforms → AJV only, Zod skipped
 * - z.array(...).default() → has .default() transform → AJV + Zod.parse()
 * - z.coerce.boolean()     → has coerce transform → AJV + Zod.parse()
 */
import { Axiomify, z } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/products',
  schema: {
    body: z.object({
      name:  z.string().min(2),
      price: z.number().positive(),
      // .default([]) is a ZodDefault — hasTransforms() detects this → Zod pass required
      tags:  z.array(z.string()).default([]),
    }),
    response: z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
      tags: z.array(z.string()),
    }),
  },
  handler: async (req, res) => {
    // req.body is fully typed: { name: string; price: number; tags: string[] }
    // tags is guaranteed [] when omitted from the request (Zod default applied)
    const product = req.body;
    res.status(201).send({ id: `prod_${Date.now()}`, ...product }, 'Product created');
  },
});

const adapter = new HttpAdapter(app);
adapter.listen(3000, () => console.log('Ready on :3000'));
