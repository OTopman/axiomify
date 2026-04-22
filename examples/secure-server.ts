import { Axiomify, z } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';
import { useCors } from '@axiomify/cors';
import { useHelmet } from '@axiomify/helmet';
import { useFingerprint } from '@axiomify/fingerprint';
import { useLogger } from '@axiomify/logger';
import { useSecurity } from '@axiomify/security';
import { randomUUID } from 'crypto';

const app = new Axiomify();

useHelmet(app, {
  removeHeaders: ['X-Powered-By', 'Server'],
  contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
});

useCors(app, {
  origin: [/^https:\/\/(app|admin)\.example\.com$/],
  credentials: true,
  strictPreflight: true,
  allowPrivateNetwork: true,
  exposedHeaders: ['X-Request-Id'],
});

useSecurity(app, {
  maxBodySize: 512 * 1024,
  sqlInjectionProtection: true,
  noSqlInjectionProtection: true,
  botProtection: true,
});

useFingerprint(app, {
  includeIp: true,
  includePath: false,
  additionalHeaders: ['x-device-id'],
});

useLogger(app, {
  level: 'info',
  beautify: true,
  includePayload: false,
  sensitiveFields: ['password', 'cardNumber', 'cvv', 'authorization'],
});

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
    const { userId, amount, cardNumber } = req.body;

    const transactionRecord = {
      transactionId: randomUUID(),
      userId,
      amount,
      cardNumber,
      fingerprint: req.state.fingerprint,
      fingerprintConfidence: req.state.fingerprintConfidence,
    };

    res.header('X-Request-Id', req.id);
    res.status(200).send(transactionRecord, 'Payment processed');
  },
});

const adapter = new FastifyAdapter(app);
adapter.listen(3000, () => {
  console.log('🚀 Axiomify secure engine running');
});
