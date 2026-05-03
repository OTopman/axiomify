# Axiomify Adapters

Axiomify decouples your application logic from the HTTP transport. Swap adapters without changing any handler, validation, or plugin code.

## Adapter comparison

| Adapter | Package | Req/s (single-core) | 4-core cluster | Best for |
|---|---|---:|---:|---|
| Native (uWS) | `@axiomify/native` | 50,493 | ~182k | Maximum throughput, new projects |
| Fastify | `@axiomify/fastify` | 10,487 | ~38k | High throughput + Fastify plugins |
| Node HTTP | `@axiomify/http` | 9,965 | ~36k | Minimal footprint, edge/serverless |
| Hapi | `@axiomify/hapi` | ~4,500 | ~16k | Hapi plugin ecosystem |
| Express | `@axiomify/express` | ~3,800 | ~14k | Express middleware compatibility |

*Benchmark: autocannon, 100 connections, pipelining 10, 12 seconds, Node 22.*

## Routing guarantee

All adapters use their underlying framework's router for route resolution. Axiomify's radix-trie router is **never** called in the dispatch path — only in the 404/405 fallback to distinguish the two cases. This means:

- Express uses Express's router
- Fastify uses Fastify's C++ radix trie
- Hapi uses Hapi's router with `{param}` path syntax
- Native uses uWS's C++ router via per-route `server.get()`, `server.post()` etc.
- HTTP uses Axiomify's router once, then passes the matched route directly — no second lookup

## Cross-adapter parity

Every adapter produces identical behaviour for the same request:

- Same response envelope `{ status, message, data }`
- Same `X-Request-Id` header
- Same Zod validation errors (400 with field-level detail)
- Same 404/405 detection
- Same hook execution order (`onRequest` → `onPreHandler` → handler → `onPostHandler`)

## Multi-core (all adapters)

All adapters expose `listenClustered()`. Workers bind the same port via the OS.

```typescript
// Native — SO_REUSEPORT (kernel-level load balancing)
const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });
adapter.listenClustered({ onWorkerReady: () => console.log(`[${process.pid}] ready`) });

// Fastify, HTTP, Express, Hapi — Node.js cluster
const adapter = new FastifyAdapter(app, { workers: 4 });
adapter.listenClustered(3000, { onWorkerReady: (p) => console.log(`[${process.pid}] :${p}`) });
```

## SSE support

| Adapter | SSE |
|---|---|
| Native | ❌ (uWS push model incompatible) |
| HTTP | ✅ |
| Express | ✅ |
| Fastify | ✅ |
| Hapi | ✅ |

## WebSocket

Use `@axiomify/ws` with any adapter via `getServerFromAdapter()`, or the native adapter's built-in uWS WebSocket for maximum performance.

```typescript
import { getServerFromAdapter, WsManager } from '@axiomify/ws';

const adapter = new FastifyAdapter(app);
await adapter.listen(3000);
const ws = new WsManager({ server: getServerFromAdapter(adapter), path: '/ws' });
```
