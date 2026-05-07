/**
 * Axiomify HTTP — clustered benchmark server.
 * Uses HttpAdapter.listenClustered() which already has SCHED_NONE + reusePort.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const port       = parseInt(process.argv[2] || '3142', 10);
const numWorkers = parseInt(process.env.WORKERS || '2', 10);

const { Axiomify }    = require('../../packages/core/dist/index.js');
const { HttpAdapter } = require('../../packages/http/dist/index.js');

const app = new Axiomify();
app.route({ method: 'GET', path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }) });

const adapter = new HttpAdapter(app, { workers: numWorkers });

adapter.listenClustered(port, {
  onPrimary: () => process.stdout.write('READY\n'),
  onWorkerReady: () => {}, // workers don't write READY
});
