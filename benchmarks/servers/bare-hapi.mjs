// Bare Hapi 21 — no Axiomify
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Hapi = require('@hapi/hapi');

const port = parseInt(process.argv[2] || '3103', 10);

const server = Hapi.server({ port, host: '0.0.0.0' });

server.route({
  method: 'GET',
  path: '/ping',
  handler: () => ({ status: 'success', data: { pong: true } }),
});

await server.start();
process.stdout.write('READY\n');

process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
