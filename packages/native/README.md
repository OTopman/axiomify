# @axiomify/native

The uWebSockets.js adapter for Axiomify. Routes registered directly with uWS's C++ router — fastest possible throughput, 50k+ req/s single-process, 180k+ req/s on 4 cores.

## Install

```bash
npm install @axiomify/native @axiomify/core zod
```

uWS ships pre-built Node.js ABI binaries. Supported: Node 18 (ABI 108), Node 20 (ABI 115), Node 22 (ABI 127).

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

app.route({
  method: 'POST',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ name: z.string().min(1) }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: req.params.id, ...req.body });
  },
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('Native on :3000'));
```

## Options

```typescript
new NativeAdapter(app, {
  port: 3000,                // listening port
  maxBodySize: 1_048_576,    // 1 MB — requests over this return 413
  trustProxy: false,         // derive req.ip from X-Forwarded-For when behind proxy
  workers: 4,                // worker count for listenClustered()
  ws: {                      // optional — omit to disable WebSocket support
    path: '/ws',
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 120,
    open: (ws) => console.log('WS connected'),
    message: (ws, msg, isBinary) => ws.send(msg, isBinary),
    close: (ws, code) => console.log('WS closed', code),
  },
});
```

| Option | Default | Description |
|---|---|---|
| `port` | `3000` | Listening port. |
| `maxBodySize` | `1048576` (1 MB) | Reject bodies over this size with 413. Enforced on the actual stream. |
| `trustProxy` | `false` | Use `X-Forwarded-For` for `req.ip`. Only enable behind a trusted proxy. |
| `workers` | `os.cpus().length` | Worker count for `listenClustered()`. |
| `ws` | disabled | WebSocket configuration. Set to `false` to explicitly disable. |

## Multi-core clustering — SO_REUSEPORT

```typescript
const adapter = new NativeAdapter(app, { port: 3000, workers: 4 });

adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] uWS ready on :3000`),
  onPrimary:     (pids) => console.log('Primary, workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} died (code ${code})`),
  // Crashed workers restart automatically
});
```

All workers bind port 3000 via `SO_REUSEPORT`. The OS kernel distributes connections across workers with zero user-space coordination. This is the most efficient multi-core strategy for uWS.

**Throughput projections (90% linear scaling):**

| Workers | GET /ping | POST /echo (JSON) |
|---:|---:|---:|
| 1 | ~50k req/s | ~37k req/s |
| 2 | ~91k req/s | ~67k req/s |
| 4 | **~182k req/s** | **~135k req/s** |
| 8 | **~363k req/s** | **~270k req/s** |

## Built-in WebSocket support

```typescript
const adapter = new NativeAdapter(app, {
  port: 3000,
  ws: {
    path: '/ws',
    open:    (ws) => { ws.send('Welcome'); },
    message: (ws, msg, isBinary) => { ws.send(msg, isBinary); }, // echo
    close:   (ws, code, msg) => { console.log('closed', code); },
  },
});
```

> For `@axiomify/ws` (the Node.js `ws` library), use `@axiomify/http`, `@axiomify/express`,
> `@axiomify/fastify`, or `@axiomify/hapi` instead. The native adapter has its own C++ WebSocket
> implementation — do not combine with `@axiomify/ws`.

## Express middleware compatibility

```typescript
import { adaptMiddleware } from '@axiomify/native';

app.route({
  method: 'GET',
  path: '/secure',
  plugins: [adaptMiddleware(require('helmet')())],
  handler: async (_req, res) => res.send({ ok: true }),
});
```

## SSE not supported

Server-Sent Events are not supported by the native adapter. The adapter throws at startup if any route calls `res.sseInit()` or `res.sseSend()`. Use `@axiomify/http`, `@axiomify/express`, `@axiomify/fastify`, or `@axiomify/hapi` for SSE routes.

## How routing works

Each Axiomify route is registered with uWS at startup:
- `GET`/`HEAD` → `server.get()` + `server.head()`
- `POST` → `server.post()`
- `DELETE` → `server.del()` (uWS uses `del` since `delete` is a reserved keyword)
- etc.

uWS resolves method+path in native C++ before any JavaScript runs. Named parameters are extracted via `req.getParameter(i)` indexed by position (pre-computed at startup) — zero allocations per request.

The `any('/*')` catch-all fires only for unmatched requests, where Axiomify's router is used once to distinguish 404 from 405.
