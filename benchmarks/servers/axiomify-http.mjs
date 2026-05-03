// Axiomify + @axiomify/http (Node.js native HTTP adapter)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Axiomify } = require('/home/claude/axiomify/packages/core/dist/index.js');
const { HttpAdapter } = require('/home/claude/axiomify/packages/http/dist/index.js');

const port = parseInt(process.argv[2] || '3110', 10);

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => {
    res.send({ pong: true });
  },
});

const adapter = new HttpAdapter(app);
const server = adapter.listen(port, () => {
  process.stdout.write('READY\n');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
