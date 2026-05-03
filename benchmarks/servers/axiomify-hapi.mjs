// Axiomify + @axiomify/hapi
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Axiomify } = require('/home/claude/axiomify/packages/core/dist/index.js');
const { HapiAdapter } = require('/home/claude/axiomify/packages/hapi/dist/index.js');

const port = parseInt(process.argv[2] || '3113', 10);

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => {
    res.send({ pong: true });
  },
});

const adapter = new HapiAdapter(app);
await adapter.listen(port);
process.stdout.write('READY\n');

process.on('SIGTERM', async () => {
  await adapter.close();
  process.exit(0);
});
