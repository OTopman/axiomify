import { Axiomify, z } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/products',
  schema: {
    body: z.object({
      name: z.string().min(2),
      price: z.number().positive(),
      tags: z.array(z.string()).default([]),
    }),
  },
  handler: async (req, res) => {
    // req.body is immediately typed as: { name: string, price: number, tags: string[] }
    // The validation layer has already executed, and defaults have been applied.
    const product = req.body;

    res.status(201).send(product, 'Product created');
  },
});

const adapter = new HttpAdapter(app);
adapter.listen(3000);
