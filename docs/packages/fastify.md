# @axiomify/fastify

Fastify 5 adapter for throughput-oriented deployments with the Fastify plugin ecosystem.

## Install

```bash
npm install @axiomify/fastify @axiomify/core fastify zod
```

## API

- `new FastifyAdapter(app, options?)` — create adapter
- `adapter.listen(port, callback?)` → `Promise<void>`
- `adapter.listenClustered(port, opts)` — fork N workers with SO_REUSEPORT
- `adapter.close()` → `Promise<void>`
- `adapter.native` → `FastifyInstance`

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `bodyLimit` | `number` | `1048576` | Max request body (1 MB) |
| `sanitize` | `boolean` | `false` | Strip prototype-pollution keys from bodies |
| `workers` | `number` | `os.availableParallelism()` | Worker count for clustering |

## Usage

```typescript
import { Axiomify } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

const adapter = new FastifyAdapter(app);
await adapter.listen(3000);
```

## Multi-core clustering

```typescript
const adapter = new FastifyAdapter(app, { workers: 4 });

adapter.listenClustered(3000, {
  onPrimary:    (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

Workers bind via `reusePort: true` (Node ≥ 16.9) or `exclusive: true` (older Node). `cluster.SCHED_NONE` set before first fork.

Measured scaling: **165% at 2 workers** on an 8-core machine with co-located loadgen.

## Routing

Routes are registered per-method on Fastify (`app.get()`, `app.post()`, etc.). Fastify's C++ radix trie resolves every request — Axiomify's trie is never in the dispatch hot path.

## Prototype pollution protection

```typescript
const adapter = new FastifyAdapter(app, { sanitize: true });
// strips __proto__, constructor, prototype from all JSON request bodies
```
