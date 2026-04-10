import { Axiomify, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';

const app = new Axiomify();

app.addHook('onRequest', (req, res) => {
  (req.state as any).startTime = process.hrtime.bigint();
});

app.addHook('onPostHandler', (req, res) => {
  const endTime = process.hrtime.bigint();
  const startTime = (req.state as any).startTime;
  if (startTime) {
    const durationMs = Number(endTime - startTime) / 1_000_000;
    console.log(
      `[Express Example] Request to ${req.path} took ${durationMs.toFixed(
        3,
      )}ms`,
    );
  }
});

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  },
  handler: async (req, res) => {
    // req.body is now strictly typed as { name: string, email: string }
    const { name, email } = req.body;
    res.status(201).send({ name, email }, 'User created successfully');
  },
});

const adapter = new ExpressAdapter(app);
adapter.listen(3000, () => {
  console.log('🚀 Axiomify Express Example listening on port 3000');
});
