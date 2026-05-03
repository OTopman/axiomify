# @axiomify/native

The high-performance uWebSockets.js adapter for Axiomify. Routes registered directly with uWS's C++ router — no JavaScript routing overhead per request.

## Install

```bash
npm install @axiomify/native @axiomify/core zod
```

uWebSockets.js ships pre-built Node.js ABI binaries. Supported: Node 18, 20, 22 (ABI 115, 120, 127).

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: { body: z.object({ email: z.string().email() }) },
  handler: async (req, res) => res.status(201).send({ id: 'usr_1', ...req.body }),
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('Native on :3000'));
```

## Multi-core clustering (recommended for production)

```typescript
const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });

adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary: (pids) => console.log('Workers:', pids),
  onWorkerExit: (pid, code) => console.error(`Worker ${pid} died (code=${code})`),
  // Crashed workers restart automatically
});
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3000` | Listening port |
| `maxBodySize` | `number` | `1048576` | Max request body in bytes; 413 on exceed |
| `trustProxy` | `boolean` | `false` | Use `X-Forwarded-For` for `req.ip` |
| `workers` | `number` | `os.cpus().length` | Workers for `listenClustered()` |
| `ws` | `NativeWsOptions \| false` | — | Enable uWS native WebSocket |

## WebSocket

```typescript
const adapter = new NativeAdapter(app, {
  port: 3000,
  ws: {
    path: '/ws',
    open: (ws) => ws.send('Welcome'),
    message: (ws, msg, isBinary) => ws.send(msg, isBinary),
    close: (ws, code) => console.log('closed', code),
  },
});
```

## SSE limitation

Server-Sent Events are not supported by the native adapter — uWS uses a push-based model incompatible with SSE. Use `@axiomify/http`, `@axiomify/express`, `@axiomify/fastify`, or `@axiomify/hapi` for SSE routes.

## Benchmark (single process, 100 connections, pipelining 10)

| Scenario | Req/s | vs bare Node.js |
|---|---:|---:|
| GET /ping | 50,493 | +174% |
| GET /users/:id/posts/:postId | 45,957 | +163% |
| POST /echo (JSON body) | 37,672 | +134% |

4-core production server (90% scaling efficiency): **~182k req/s**.
