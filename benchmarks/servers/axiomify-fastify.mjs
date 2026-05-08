// Axiomify + @axiomify/fastify
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Axiomify } = require('../../packages/core/dist/index.js');
const { FastifyAdapter } = require('../../packages/fastify/dist/index.js');

const port = parseInt(process.argv[2] || '3112', 10);

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => {
    res.send({ pong: true });
  },
});

const adapter = new FastifyAdapter(app);
await adapter.listen(port);
process.stdout.write('READY\n');

process.on('SIGTERM', async () => {
  await adapter.close();
  process.exit(0);
});
