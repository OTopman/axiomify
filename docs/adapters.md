# Axiomify Adapters

Axiomify decouples application logic from the HTTP transport. Swap adapters without changing any handler, validation, or plugin code.

## Adapter comparison

| Adapter | Package | Req/s (single-core) | 2-core cluster | Best for |
|---|---|---:|---:|---|
| Native (uWS) | `@axiomify/native` | 73,000–84,000 | ~91k† | Maximum throughput, new projects |
| Node HTTP | `@axiomify/http` | 32,800 | 57,200 | Minimal footprint, edge/serverless |
| Fastify | `@axiomify/fastify` | 31,300 | 35,200 | Fastify plugin ecosystem |
| Hapi | `@axiomify/hapi` | 9,900 | — | Hapi enterprise ecosystem |
| Express | `@axiomify/express` | 7,300 | — | Legacy middleware compatibility |

*Benchmark: autocannon 100 connections, pipelining 10, 12 s, Node 22, 8-core machine, co-located loadgen.*
*† Native 2w is autocannon-limited (~90k req/s ceiling co-located). Dedicated loadgen gives near-linear scaling.*

## Routing guarantee

All adapters use their own router for route resolution. Axiomify's trie router is only consulted in the 404/405 fallback:

- **Native** — uWS C++ router via `server.get()`, `server.post()` etc.
- **Fastify** — Fastify's C++ radix trie
- **Hapi** — Hapi's router with `{param}` syntax
- **Express** — Express's router
- **HTTP** — Axiomify's trie, once, then `handleMatchedRoute` — no second lookup

## Cross-adapter parity

All adapters produce identical behaviour for the same request:

- Same `{ status, message, data }` envelope
- Same Zod validation errors (400 + field-level detail)
- Same 404/405 detection
- Same hook execution order (`onRequest` → `onPreHandler` → handler → `onPostHandler`)

`X-Request-Id` is opt-in since v5 — call `app.enableRequestId()` after constructing the app.

## Multi-core clustering (v5)

All adapters expose `listenClustered()`. Since v5, all adapters use SO_REUSEPORT — each worker owns its socket. The kernel distributes connections with zero IPC.

### Previous behaviour (v4 and earlier)

Cluster's `SCHED_RR` default: the primary accepted every TCP connection and forwarded file descriptors to workers via IPC. The primary's `accept()` loop was the bottleneck regardless of worker count. Multi-worker configs showed <10% gain.

### Current behaviour (v5)

`cluster.SCHED_NONE` set before first fork. Workers bind with `reusePort: true` (Node ≥ 16.9) or `exclusive: true` (older Node). Verified: 160–165% scaling at 2 workers on 8-core hardware.

```typescript
// Native
const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});

// HTTP / Fastify / Express / Hapi
const adapter = new HttpAdapter(app, { workers: 4 });
adapter.listenClustered(3000, {
  onPrimary:    (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} died`, code),
});
```

### Crash circuit breaker

5+ worker crashes within 30 s → primary aborts. Prevents runaway respawn loops on misconfigured workers.

### Zero-downtime rolling restart

`kill -USR2 <primary-pid>` — kills one worker at a time, spaced by `gracefulTimeoutMs`. A replacement is always serving before the next is killed.

### Worker count

Default: `os.availableParallelism()` (respects container CPU limits). Never set above physical core count. The adapter warns on oversubscription.

### Verifying SO_REUSEPORT

```bash
lsof -i :3000
```

You should see N separate processes each with a `LISTEN` entry. If only one process appears, SO_REUSEPORT is not active.

## SSE support

| Adapter | SSE |
|---|---|
| Native | ❌ (uWS push model incompatible) |
| HTTP | ✅ |
| Express | ✅ |
| Fastify | ✅ |
| Hapi | ✅ |

Since v5, SSE capability is declared via `res.capabilities.sse` — check before calling `sseInit()`:

```typescript
if (res.capabilities.sse) {
  (res as SseCapableResponse).sseInit();
}
```

## WebSocket

```typescript
import { getServerFromAdapter, WsManager } from '@axiomify/ws';

// Any HTTP adapter
const adapter = new FastifyAdapter(app);
await adapter.listen(3000);
const ws = new WsManager({ server: getServerFromAdapter(adapter), path: '/ws' });

// Native — use uWS built-in WebSocket
new NativeAdapter(app, {
  port: 3000,
  ws: { path: '/ws', open: (ws) => ws.send('hello'), message: (ws, msg) => ws.send(msg) },
});
```

## Benchmark methodology

The comparison table uses co-located loadgen. Single-process numbers are accurate.
Clustered numbers at 4+ workers may show regression because autocannon shares CPUs with server workers.

For accurate clustered numbers, run on a separate machine:

```bash
# Server box
WORKERS=6 node benchmarks/servers/axiomify-http-clustered.mjs 3000

# Loadgen box
SERVER_HOST=<server-ip> node benchmarks/run-clustered.mjs
```

The benchmark runner flags `← loadgen starved` where `N-worker < (N-1)-worker` throughput.
