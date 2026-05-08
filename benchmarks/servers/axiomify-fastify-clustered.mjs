/**
 * Axiomify Fastify — clustered benchmark server.
 * Uses FastifyAdapter.listenClustered() which already has SCHED_NONE + reusePort.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const port       = parseInt(process.argv[2] || '3141', 10);
const numWorkers = parseInt(process.env.WORKERS || '2', 10);

const { Axiomify }      = require('../../packages/core/dist/index.js');
const { FastifyAdapter } = require('../../packages/fastify/dist/index.js');

const app = new Axiomify();
app.route({ method: 'GET', path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }) });

const adapter = new FastifyAdapter(app, { workers: numWorkers });

adapter.listenClustered(port, {
  onPrimary: () => process.stdout.write('READY\n'),
});
