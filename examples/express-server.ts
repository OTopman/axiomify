import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';

// 1. Initialize the Core Engine
const app = new Axiomify();

// 2. Register Global Plugins (Lifecycle hooks)
app.addHook('onRequest', async (req, res) => {
  console.log(`[${req.id}] Incoming: ${req.method} ${req.path}`);
  req.state.startTime = Date.now();
});

app.addHook('onPostHandler', async (req, res) => {
  const duration = Date.now() - req.state.startTime;
  res.header('x-response-time', `${duration}ms`);
});

// 3. Define a Route with strict types and schema validation
app.route({
  method: 'POST',
  path: '/api/v1/users',
  schema: {
    body: { required: true }, // Hooks into our ValidationCompiler
  },
  handler: async (req, res) => {
    // req.body is strongly typed based on generic injection (to be added via Zod/Typebox later)
    const userData = req.body;

    // Simulate DB save
    const user = { id: 99, ...(userData as any) };

    // Delivers our unified response contract automatically
    res.status(201).send(user, 'User created successfully');
  },
});

// 4. Bind the Core to the Express Adapter and start listening
const adapter = new ExpressAdapter(app);

adapter.listen(3000, () => {
  console.log('🚀 Axiomify engine running on Express port 3000');
});
