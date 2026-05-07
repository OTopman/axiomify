# @axiomify/http

Node.js native HTTP adapter. Zero external dependencies beyond `@axiomify/core`.

## Install

```bash
npm install @axiomify/http @axiomify/core zod
```

## API

- `new HttpAdapter(app, options?)` — create adapter
- `adapter.listen(port, callback?)` → `http.Server`
- `adapter.listenClustered(port, opts)` — fork N workers with SO_REUSEPORT
- `adapter.close()` → `Promise<void>`
- `adapter.native` → `http.Server`

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `bodyLimitBytes` | `number` | `1048576` | Max request body (1 MB) |
| `trustProxy` | `boolean` | `false` | Trust `X-Forwarded-For` |
| `workers` | `number` | `os.availableParallelism()` | Worker count for clustering |

## Usage

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

const adapter = new HttpAdapter(app);
adapter.listen(3000, () => console.log('Ready on :3000'));
```

## Multi-core clustering

```typescript
const adapter = new HttpAdapter(app, { workers: 4 });

adapter.listenClustered(3000, {
  onWorkerReady: (port) => console.log(`[${process.pid}] :${port}`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} died (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

Workers bind via `reusePort: true` (Node ≥ 16.9) or `exclusive: true` (older Node). `cluster.SCHED_NONE` set before first fork.

Measured scaling: **160% at 2 workers** on an 8-core machine with co-located loadgen.

Crash circuit breaker: 5+ crashes in 30 s aborts the primary.
SIGUSR2: `kill -USR2 <primary-pid>` for zero-downtime rolling restart.

## Routing

Axiomify's trie router resolves the route once. The matched route and params are passed directly to `handleMatchedRoute` — `core.handle()` is never called. 404/405 are detected via the same single lookup.
