/**
 * @axiomify/native — production example with clustering and WebSocket.
 *
 * Demonstrates:
 * - uWS native adapter (50k+ req/s per core)
 * - listenClustered() for multi-core scaling
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

useHelmet(app);
useCors(app, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
});

const limiter = createRateLimitPlugin({
  store: new MemoryStore(), // use RedisStore in production
  max: 100,
  windowMs: 60_000,
  allowMemoryStoreInProduction: true,
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
  },
  handler: async (req, res) => {
    res.status(201).send({ id: 'usr_' + Date.now(), ...req.body });
  },
});

app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string() }),
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
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] Axiomify Native on :${PORT}`),
  onPrimary: (pids) =>
    console.log(`Primary ${process.pid} managing ${pids.length} workers`),
  onWorkerExit: (pid, code) =>
    console.error(`Worker ${pid} exited (code=${code}) — restarting`),
});
