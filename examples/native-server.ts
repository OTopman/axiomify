/**
 * @axiomify/native — production example with clustering and WebSocket.
 *
 * Demonstrates:
 * - uWS native adapter (73–84k req/s per core)
 * - listenClustered() for multi-core scaling with SO_REUSEPORT
 * - Crash circuit breaker (5 crashes/30s → primary aborts)
 * - SIGUSR2 rolling restart for zero-downtime reload
 * - Zod schema validation
 * - Rate limiting
 * - Security hardening
 */
import { Axiomify } from '@axiomify/core';
import { useCors } from '@axiomify/cors';
import { useHelmet } from '@axiomify/helmet';
import { NativeAdapter } from '@axiomify/native';
import { createRateLimitPlugin, MemoryStore } from '@axiomify/rate-limit';
import { z } from 'zod';

const app = new Axiomify();

// X-Request-Id is opt-in since v5 — call explicitly
app.enableRequestId();

useHelmet(app);
useCors(app, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
});

const limiter = createRateLimitPlugin({
  store: new MemoryStore(),   // use RedisStore in production
  max: 100,
  windowMs: 60_000,
  allowMemoryStoreInProduction: true,
});

app.route({
  method: 'GET',
  path: '/health',
  schema: { tags: ['system'], summary: 'Health check' },
  handler: async (_req, res) => res.send({ status: 'ok', uptime: process.uptime() }),
});

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

app.route({
  method: 'POST',
  path: '/users',
  plugins: [limiter],
  schema: {
    body: z.object({
      email: z.string().email(),
      name: z.string().min(2).max(100),
    }),
    response: z.object({ id: z.string(), email: z.string(), name: z.string() }),
    tags: ['Users'],
    summary: 'Create user',
  },
  handler: async (req, res) => {
    res.status(201).send({ id: `usr_${Date.now()}`, ...req.body });
  },
});

app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().min(1) }),
  },
  handler: async (req, res) => {
    res.send({ id: req.params.id, name: 'Ada Lovelace' });
  },
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const adapter = new NativeAdapter(app, { port: PORT });

// Single process:
// adapter.listen(() => console.log(`Native server on :${PORT}`));

// Multi-core (production):
// workers defaults to os.availableParallelism() — respects container CPU limits
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] Axiomify Native on :${PORT}`),
  onPrimary:     (pids) => console.log(`Primary ${process.pid} — workers: [${pids.join(', ')}]`),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});
// Zero-downtime reload: kill -USR2 <primary-pid>
