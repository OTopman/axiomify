# @axiomify/fastify

Fastify adapter for Axiomify. Uses Fastify's native radix-trie router for all routing — no double routing, no catch-all bypass.

## Install

```bash
npm install @axiomify/fastify @axiomify/core fastify zod
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: '1', ...req.body });
  },
});

const adapter = new FastifyAdapter(app);
await adapter.listen(3000);
console.log('Fastify on :3000');
```

## Options

```typescript
new FastifyAdapter(app, {
  bodyLimit: 1_048_576,  // 1 MB in bytes (Fastify native option)
  workers: 4,            // used by listenClustered()
  fastifyOptions: {      // pass-through to Fastify constructor
    logger: true,
    http2: true,
  },
});
```

| Option | Default | Description |
|---|---|---|
| `bodyLimit` | Fastify default (1 MiB) | Maximum body size in bytes. |
| `workers` | `os.cpus().length` | Worker count for `listenClustered()`. |
| `fastifyOptions` | `{}` | Passed directly to the Fastify constructor. |

## Multi-core clustering

```typescript
const adapter = new FastifyAdapter(app, { workers: 4 });
adapter.listenClustered(3000, {
  onWorkerReady: (port) => console.log(`[${process.pid}] Fastify :${port}`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} died`),
});
```

## Routing

Each Axiomify route is registered directly with Fastify's router using `app.get()`, `app.post()`, etc. Fastify's C++ radix trie resolves the route and populates `req.params` before Axiomify's pipeline runs. Axiomify's router is consulted **only** in the `setNotFoundHandler` fallback to distinguish 404 from 405.

## Fastify v5 JSON body parsing

The adapter overrides Fastify's built-in JSON parser to allow empty bodies on methods like `DELETE` and `HEAD`. Without this, Fastify v5 rejects `DELETE` requests with a `Content-Type: application/json` header but no body — preventing 405 detection.

## When to use @axiomify/fastify

- Recommended default for production — 10k+ req/s single-core, ~38k with 4 workers
- Need Fastify plugins (`@fastify/swagger`, `@fastify/jwt`, etc.)
- Want HTTP/2 support

For maximum throughput (50k+ req/s), use `@axiomify/native` (uWebSockets.js).
