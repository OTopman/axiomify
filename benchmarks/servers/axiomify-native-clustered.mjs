/**
 * Axiomify Native — clustered benchmark server.
 *
 * Each worker binds the port directly via SO_REUSEPORT (Linux) / exclusive
 * (other platforms). The kernel load-balances connections at the socket layer —
 * zero IPC in the request hot path. SCHED_NONE is set in the primary before
 * any fork so the cluster module does NOT intercept worker listen() calls.
 *
 * Usage:
 *   WORKERS=4 node benchmarks/servers/axiomify-native-clustered.mjs <port>
 */
import cluster from 'cluster';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const port      = parseInt(process.argv[2] || '3140', 10);
const numWorkers = parseInt(process.env.WORKERS || '2', 10);

if (!cluster.isPrimary) {
  const { Axiomify }     = require('../../packages/core/dist/index.js');
  const { NativeAdapter } = require('../../packages/native/dist/index.js');

  const app = new Axiomify();
  app.route({ method: 'GET',  path: '/ping',
    handler: async (_req, res) => res.send({ pong: true }) });
  app.route({ method: 'POST', path: '/echo',
    handler: async (req, res) => res.send(req.body) });
  app.route({ method: 'GET',  path: '/users/:id/posts/:postId',
    handler: async (req, res) => res.send({ id: req.params.id, postId: req.params.postId }) });

  // uWS binds directly — SO_REUSEPORT is handled by uWS internals on Linux.
  // The key is that SCHED_NONE was set in the primary before this fork,
  // so the cluster module does not intercept our listen call.
  const adapter = new NativeAdapter(app, { port, trustProxy: false });
  adapter.listen(() => process.send?.({ type: 'WORKER_READY' }));

  process.on('SIGTERM', () => { adapter.close(); process.exit(0); });

} else {
  // SCHED_NONE: must be set before the first cluster.fork().
  // Without this, workers' listen() calls are re-routed through the primary
  // via IPC — eliminating all parallelism benefit.
  cluster.schedulingPolicy = cluster.SCHED_NONE;

  let readyCount = 0;
  const liveWorkers = new Map();

  const spawnWorker = () => {
    const w = cluster.fork({ NODE_ENV: 'production' });
    w.once('online', () => { if (w.process.pid) liveWorkers.set(w.process.pid, w); });
    w.on('message', (msg) => {
      if (msg?.type !== 'WORKER_READY') return;
      readyCount++;
      if (readyCount === numWorkers) process.stdout.write('READY\n');
    });
    w.on('exit', (code, signal) => {
      liveWorkers.delete(w.process.pid ?? 0);
      if (code !== 0 && signal !== 'SIGTERM') spawnWorker();
    });
  };

  for (let i = 0; i < numWorkers; i++) spawnWorker();

  process.on('SIGTERM', () => {
    for (const w of liveWorkers.values()) w.process.kill('SIGTERM');
    process.exit(0);
  });
}
