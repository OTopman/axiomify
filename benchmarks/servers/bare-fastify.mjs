// Bare Fastify 5 — no Axiomify
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fastifyFactory = require('fastify');

const port = parseInt(process.argv[2] || '3102', 10);
const fastify = fastifyFactory.default ? fastifyFactory.default({ logger: false }) : fastifyFactory({ logger: false });

fastify.get('/ping', async () => {
  return { status: 'success', data: { pong: true } };
});

await fastify.listen({ port });
process.stdout.write('READY\n');

process.on('SIGTERM', async () => { await fastify.close(); process.exit(0); });
