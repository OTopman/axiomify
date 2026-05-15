# @axiomify/native

uWebSockets.js adapter — highest-throughput Axiomify transport.

## Install

```bash
npm install @axiomify/native @axiomify/core zod
```

Node.js ≥ 18, < 23. uWS is a pre-compiled native binary — check the [uWebSockets.js release page](https://github.com/uNetworking/uWebSockets.js) for your platform support.

## API

- `new NativeAdapter(app, options?)` — create adapter
- `adapter.listen(callback?)` → starts listening
- `adapter.listenClustered(opts)` — fork N worker processes with SO_REUSEPORT
- `adapter.close()` — closes the listening socket

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3000` | Listen port |
| `maxBodySize` | `number` | `1048576` | Max request body (1 MB) |
| `trustProxy` | `boolean` | `false` | Trust `X-Forwarded-For` for `req.ip` |
| `workers` | `number` | `os.availableParallelism()` | Worker count for `listenClustered()` |
| `ws` | `NativeWsOptions` | — | Built-in fallback uWS WebSocket options (Legacy)

## Usage

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

app.route({
  method: 'POST',
  path: '/users',
  schema: { body: z.object({ name: z.string(), email: z.string().email() }) },
  handler: async (req, res) => {
    res.status(201).send({ id: 'usr_1', ...req.body });
  },
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('Ready on :3000'));
```

## Multi-core clustering

```typescript
const adapter = new NativeAdapter(app, { port: 3000 });

adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary:     (pids) => console.log(`Primary managing ${pids.length} workers`),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} exited (${code})`),
  gracefulTimeoutMs: 10_000,
});
```

uWS workers bind via SO_REUSEPORT natively. The kernel distributes connections across workers at the socket layer — zero IPC in the request hot path.

## WebSockets

Axiomify Native fully supports Zod-validated, hook-integrated WebSockets directly via `app.ws()`:

```typescript
app.ws({
  path: '/chat',
  schema: { message: z.object({ text: z.string() }) },
  onPreHandler: async (req, res) => {
     // authenticate
  },
  message: (client, data) => {
    client.publish('room', data);
  }
});
```

## Express middleware bridge

```typescript
import { adaptMiddleware } from '@axiomify/native';
import cors from 'cors';

const corsMiddleware = adaptMiddleware(cors({ origin: 'https://example.com' }));

app.addHook('onRequest', corsMiddleware);
```

## Routing

Routes are registered directly on the uWS app via `server.get()`, `server.post()`, etc. uWS resolves the route in C++ before any JavaScript runs. Axiomify's trie router is used only for 404/405 detection.

## SSE

Axiomify Native supports Server-Sent Events natively out of the box using `res.sseInit()` and `res.sseSend()`.

```typescript
app.route({
  method: 'GET',
  path: '/sse',
  handler: (req, res) => {
    res.sseInit(15000); // optional heartbeat
    res.sseSend({ hello: 'world' }, 'greet');
  }
});
```

## Benchmarks (8-core machine, autocannon 100 conns, pipelining 10, 12 s)

| Scenario | Req/s | Avg lat | p99 |
|---|---:|---:|---:|
| GET /ping (no body, no params) | 73,511 | 13 ms | 26 ms |
| GET /users/:id/posts/:postId (2 params) | 83,947 | 11 ms | 20 ms |
| POST /echo (JSON body parse + echo) | 54,720 | 18 ms | 30 ms |

The param route outperforms ping because the router optimisation (caller-provided `paramsOut`) eliminates the intermediate object allocation — better cache locality than the no-param path under sustained load.
