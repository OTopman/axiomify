# @axiomify/http

The native Node.js HTTP adapter for Axiomify. Zero external dependencies — wraps `node:http` directly.

## Install

```bash
npm install @axiomify/http @axiomify/core zod
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: 1, ...req.body });
  },
});

const adapter = new HttpAdapter(app);
adapter.listen(3000, () => console.log('Listening on :3000'));
```

## Options

```typescript
new HttpAdapter(app, {
  bodyLimitBytes: 1_048_576, // 1 MB (default)
  trustProxy: false,         // set true when behind nginx / ALB
  workers: 4,                // used by listenClustered()
});
```

| Option | Default | Description |
|---|---|---|
| `bodyLimitBytes` | `1048576` (1 MB) | Maximum request body size. Requests over this limit return 413. |
| `trustProxy` | `false` | Derive `req.ip` from `X-Forwarded-For`. Only enable behind a trusted proxy. |
| `workers` | `os.cpus().length` | Worker count for `listenClustered()`. |

## Single process

```typescript
const server = adapter.listen(3000, () => console.log('Ready'));
// Returns the raw http.Server — use it with @axiomify/ws
```

## Multi-core clustering

```typescript
// server.ts — run with: node server.ts
import cluster from 'cluster';

const adapter = new HttpAdapter(app, { workers: 4 });

adapter.listenClustered(3000, {
  onWorkerReady: (port) => console.log(`[${process.pid}] Worker ready on :${port}`),
  onPrimary:     (pids) => console.log(`Primary ${process.pid} → workers: ${pids.join(', ')}`),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} exited (code ${code})`),
  // Crashed workers restart automatically
});
```

> On a 4-core server, `listenClustered()` multiplies throughput ~4×. Node.js cluster
> distributes connections across workers via round-robin. Each worker runs independently
> with its own V8 heap and event loop.

## Routing

The adapter calls `core.router.lookup()` **once** per request, then passes the resolved route
directly to `core.handleMatchedRoute()`. Axiomify's router is never called a second time —
there is no double routing.

## When to use @axiomify/http

- Zero-dependency microservices or serverless functions
- When you need the raw `http.Server` for WebSocket upgrades (`@axiomify/ws`)
- Environments where Fastify or Express are too heavy

For maximum throughput on persistent servers, use [`@axiomify/native`](../native/) (uWebSockets.js)
or [`@axiomify/fastify`](../fastify/) instead.
