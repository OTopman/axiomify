import { Axiomify } from '@axiomify/core';
import { useCors } from '@axiomify/cors';
import { useHelmet } from '@axiomify/helmet';
import { useLogger } from '@axiomify/logger';
import { useObservability } from '@axiomify/observability';
import { MemoryStore, useRateLimit } from '@axiomify/rate-limit';
import { useSecurity } from '@axiomify/security';
import { z } from 'zod';

const port = Number(process.env.PORT ?? 3000);
const origin = process.env.CORS_ORIGIN;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

export const app = new Axiomify({ strictSchema: true });

app.enableRequestId();
useObservability(app);
useHelmet(app);
useSecurity(app);
useCors(app, {
  // Set CORS_ORIGIN in production. A missing value allows same-origin calls.
  origin: origin ? [origin] : [],
  credentials: false,
});
useRateLimit(app, {
  max: 100,
  windowMs: 60_000,
  // Replace this per-process store with RedisStore when running more than one
  // process or replica.
  store: new MemoryStore(),
});
useLogger(app, { level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info' });

const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(120),
  complete: z.boolean(),
});
const tasks = new Map<string, z.infer<typeof taskSchema>>();

app.route({
  method: 'GET',
  path: '/health',
  schema: { response: z.object({ status: z.literal('ok') }) },
  handler: (_req, res) => res.send({ status: 'ok' }),
});

app.group('/api/v1', (v1) => {
  v1.route({
    method: 'GET',
    path: '/tasks',
    schema: { response: z.array(taskSchema) },
    handler: (_req, res) => res.send([...tasks.values()]),
  });

  v1.route({
    method: 'POST',
    path: '/tasks',
    schema: {
      body: z.object({ title: z.string().min(1).max(120) }),
      response: taskSchema,
    },
    handler: (req, res) => {
      const task = { id: crypto.randomUUID(), title: req.body.title, complete: false };
      tasks.set(task.id, task);
      res.status(201).send(task);
    },
  });
});

if (require.main === module) {
  // Keep the native binding out of the test/import path. This lets the
  // inject-style test suite run anywhere supported by core, while production
  // startup still fails fast if the selected Node/uWS binary is unavailable.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NativeAdapter } = require('@axiomify/native') as typeof import('@axiomify/native');
  new NativeAdapter(app, { port }).listen(() => {
    console.log(`REST API listening on :${port}`);
  });
}
