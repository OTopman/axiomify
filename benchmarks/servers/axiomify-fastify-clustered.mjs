/**
 * Axiomify Fastify — clustered benchmark server.
 */
import cluster from 'cluster';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const port = parseInt(process.argv[2] || '3141', 10);
const numWorkers = parseInt(process.env.WORKERS || '2', 10);

if (!cluster.isPrimary) {
  // Suppress benign EPIPE from IPC when primary exits before worker close() message
  process.on('uncaughtException', (err) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_IPC_CHANNEL_CLOSED') return;
    process.stderr.write(err.stack + '\n');
    process.exit(1);
  });

  const { Axiomify } = require('../../packages/core/dist/index.js');
  const { FastifyAdapter } = require('../../packages/fastify/dist/index.js');

  const app = new Axiomify();
  app.route({
    method: 'GET',
    path: '/ping',
    handler: async (_req, res) => res.send({ pong: true }),
  });

  const adapter = new FastifyAdapter(app);
  await adapter.listen(port);
  try {
    process.send?.('WORKER_READY');
  } catch {
    /* EPIPE — primary already gone */
  }

  process.on('SIGTERM', async () => {
    try {
      await adapter.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
} else {
  let readyCount = 0;

  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork({ NODE_ENV: 'production' });
    worker.on('message', (msg) => {
      if (msg === 'WORKER_READY') {
        readyCount++;
        if (readyCount === numWorkers) process.stdout.write('READY\n');
      }
    });
    worker.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM')
        cluster.fork({ NODE_ENV: 'production' });
    });
  }

  process.on('SIGTERM', () => {
    for (const w of Object.values(cluster.workers ?? {})) w?.kill('SIGTERM');
    process.exit(0);
  });
}
