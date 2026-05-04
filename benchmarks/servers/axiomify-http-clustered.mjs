/**
 * Axiomify HTTP — clustered benchmark server.
 */
import cluster from 'cluster';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const port = parseInt(process.argv[2] || '3142', 10);
const numWorkers = parseInt(process.env.WORKERS || '2', 10);

if (!cluster.isPrimary) {
  const { Axiomify } = require('../../packages/core/dist/index.js');
  const { HttpAdapter } = require('../../packages/http/dist/index.js');

  const app = new Axiomify();
  app.route({
    method: 'GET',
    path: '/ping',
    handler: async (_req, res) => res.send({ pong: true }),
  });

  const adapter = new HttpAdapter(app);
  adapter.listen(port, () => process.send?.('WORKER_READY'));

  process.on('SIGTERM', async () => {
    await adapter.close();
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
