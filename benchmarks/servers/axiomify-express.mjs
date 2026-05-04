// Axiomify + @axiomify/express
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Axiomify } = require('../../packages/core/dist/index.js');
const { ExpressAdapter } = require('../../packages/express/dist/index.js');

const port = parseInt(process.argv[2] || '3111', 10);

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => {
    res.send({ pong: true });
  },
});

const adapter = new ExpressAdapter(app);
const server = adapter.listen(port, () => {
  process.stdout.write('READY\n');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
