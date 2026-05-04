/**
 * Axiomify Native — clustered benchmark server.
 *
 * Production pattern: primary forks one worker per CPU core, each worker
 * binds the same port via uWS's native SO_REUSEPORT. The kernel load-balances
 * connections across workers at the socket level — zero user-space overhead.
 *
 * Usage:
 *   WORKERS=4 node benchmarks/servers/axiomify-native-clustered.mjs <port>
 *
 * The primary process writes "READY" only after ALL workers have confirmed
 * they are listening.
 */
import cluster from 'cluster';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const port = parseInt(process.argv[2] || '3140', 10);
const numWorkers = parseInt(process.env.WORKERS || '2', 10);

if (!cluster.isPrimary) {
  // ── Worker process ────────────────────────────────────────────────────────
  const { Axiomify } = require('../../packages/core/dist/index.js');
  const { NativeAdapter } = require('../../packages/native/dist/index.js');

  const app = new Axiomify();
  app.route({
    method: 'GET',
    path: '/ping',
    handler: async (_req, res) => res.send({ pong: true }),
  });
  app.route({
    method: 'POST',
    path: '/echo',
    handler: async (req, res) => res.send(req.body),
  });
  app.route({
    method: 'GET',
    path: '/users/:id/posts/:postId',
    handler: async (req, res) =>
      res.send({ id: req.params.id, postId: req.params.postId }),
  });

  const adapter = new NativeAdapter(app, { port, trustProxy: false });
  adapter.listen(() => {
    process.send?.('WORKER_READY');
  });

  process.on('SIGTERM', () => {
    adapter.close();
    process.exit(0);
  });
} else {
  // ── Primary process ───────────────────────────────────────────────────────
  let readyCount = 0;

  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork({ NODE_ENV: 'production' });

    worker.on('message', (msg) => {
      if (msg === 'WORKER_READY') {
        readyCount++;
        if (readyCount === numWorkers) {
          // All workers confirmed — signal benchmark runner
          process.stdout.write(`READY\n`);
        }
      }
    });

    worker.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM') {
        // Auto-restart crashed workers
        const replacement = cluster.fork({ NODE_ENV: 'production' });
        replacement.on('message', (msg) => {
          if (msg === 'WORKER_READY') {
            process.stderr.write(
              `[primary] Replacement worker ${replacement.process.pid} ready\n`,
            );
          }
        });
      }
    });
  }

  process.on('SIGTERM', () => {
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.kill('SIGTERM');
    }
    process.exit(0);
  });
}
