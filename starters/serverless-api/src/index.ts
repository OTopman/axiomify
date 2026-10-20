import { Axiomify } from '@axiomify/core';
import { ServerlessAdapter } from '@axiomify/serverless';
import { z } from 'zod';

export const app = new Axiomify({ strictSchema: true });
app.enableRequestId();

const itemSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
});
const items = new Map<string, z.infer<typeof itemSchema>>();

app.route({
  method: 'GET',
  path: '/health',
  schema: { response: z.object({ status: z.literal('ok') }) },
  handler: (_req, res) => res.send({ status: 'ok' }),
});

app.group('/api/v1', (v1) => {
  v1.route({
    method: 'GET',
    path: '/items',
    schema: { response: z.array(itemSchema) },
    handler: (_req, res) => res.send([...items.values()]),
  });

  v1.route({
    method: 'POST',
    path: '/items',
    schema: {
      body: z.object({ name: z.string().min(1).max(100) }),
      response: itemSchema,
    },
    handler: (req, res) => {
      const item = { id: crypto.randomUUID(), name: req.body.name };
      items.set(item.id, item);
      res.status(201).send(item);
    },
  });
});

const adapter = new ServerlessAdapter(app, { maxBodySize: 1024 * 1024 });

/** Export this Fetch-compatible handler from the target platform entrypoint. */
export function fetchHandler(request: Request): Promise<Response> {
  return adapter.handle(request);
}
