import { Axiomify, z } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';
import { useLogger } from '@axiomify/logger';

const app = new Axiomify();

// 1. Initialize the Logger & Masking Engine
useLogger(app, {
  level: 'info',
  sensitiveFields: ['password', 'cardNumber', 'cvv', 'authorization'],
});

// 2. Define a secure route
app.route({
  method: 'POST',
  path: '/api/v1/payments',
  schema: {
    body: z.object({
      userId: z.string().uuid(),
      cardNumber: z.string().length(16),
      cvv: z.string().length(3),
      amount: z.number().positive(),
    }),
  },
  handler: async (req, res) => {
    // Business logic...
    const { userId, amount, cardNumber } = req.body;

    const transactionRecord = {
      transactionId: crypto.randomUUID(),
      userId,
      amount,
      cardNumber, // Intentionally sending it back to prove the mask works
    };

    res.status(200).send(transactionRecord, 'Payment processed');
  },
});

const adapter = new FastifyAdapter(app);
adapter.listen(3000, () => {
  console.log('🚀 Axiomify secure engine running');
});
