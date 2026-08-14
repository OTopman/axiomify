# @axiomify/socket.io

Socket.IO 4.4+ bridge for `@axiomify/native`. Attach Socket.IO to the same `uWebSockets.js` server that handles HTTP — one listener, one event loop, one drain path. No proxy in front, no second Node process, no port juggling.

## Install

```bash
npm install @axiomify/socket.io socket.io
```

`socket.io` is a peer dependency. Use ≥ **4.4.0** — earlier releases lack the `attachApp(uWSApp)` method that makes this bridge possible.

## Quick start

```ts
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { attachSocketIO } from '@axiomify/socket.io';

const app = new Axiomify();
app.route({
  method: 'GET',
  path: '/health',
  handler: async (_req, res) => res.send({ ok: true }),
});

const adapter = new NativeAdapter(app, { port: 3000 });

// Must run BEFORE adapter.listen() — uWS does not permit route /
// upgrade registration on a listening socket.
const io = await attachSocketIO(adapter, {
  cors: { origin: 'https://app.example.com' },
});

io.on('connection', (socket) => {
  socket.emit('welcome', { msg: 'hi' });
  socket.on('chat', (msg) => io.emit('chat', msg));
});

adapter.listen(() => console.log('HTTP + Socket.IO on :3000'));
```

That's the whole API surface for a basic deployment. The returned `io` is a stock `socket.io` `Server` instance — anything you'd do with a standalone Socket.IO server works here.

## Why this exists

Socket.IO is built for Node's `http.Server`. `@axiomify/native` is built on `uWebSockets.js`. Without this bridge, integrating Socket.IO meant running a second Node server alongside uWS and reverse-proxying between them — extra ports, extra processes, two separate `gracefulShutdown` flows, two sets of TLS certs.

Socket.IO 4.4 added native uWS support via `io.attachApp(uwsApp)`. This package wires that into Axiomify's adapter lifecycle:

1. Reaches into `NativeAdapter` (via the same `ADAPTER_LOCK_TOKEN` gate the framework's own internal APIs use) and grabs the underlying uWS app.
2. Calls `io.attachApp(uwsApp, options)` before `adapter.listen()`.
3. Registers a shutdown callback so `adapter.gracefulShutdown()` closes all Socket.IO connections cleanly before exit.

The result: HTTP, native WebSocket routes (`app.ws()`), AND Socket.IO all share one event loop, one drain path, and one process.

## API

| Export                              | Purpose                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `attachSocketIO(adapter, options?)` | Attach a Socket.IO server to the adapter. Returns `Promise<IOServer>`.              |
| `adaptAxiomifyPlugin(plugin)`       | Wrap an Axiomify `RouteMiddleware` so it can run as `io.use(...)` middleware.       |
| `Socket`, `IOServer` (types)        | Re-exported from `socket.io` so consumers don't need `@types/socket.io` separately. |

### `attachSocketIO(adapter, options?)`

```ts
const io = await attachSocketIO(adapter, {
  // Any socket.io `ServerOptions` field works here verbatim:
  cors: { origin: ['https://app.example.com'], credentials: true },
  path: '/socket.io/',
  transports: ['websocket'],

  // Axiomify-specific extensions:
  drainOnAdapterShutdown: true, // default: close IO on adapter.gracefulShutdown()
  onAttached: (io) => console.log('IO ready'),
});
```

Must be called BEFORE `adapter.listen()`. The function is async because it dynamically imports `socket.io` (lets projects that don't use this bridge skip the install cost during static analysis).

Throws if:

- `socket.io` is not installed (clean install hint).
- The bridge was already attached to this adapter (use `io.of(name)` for namespaces instead).

### `adaptAxiomifyPlugin(plugin)`

Reuse Axiomify route plugins (auth, rate-limit, fingerprint) as Socket.IO middleware:

```ts
import { createAuthPlugin } from '@axiomify/auth';
import { adaptAxiomifyPlugin } from '@axiomify/socket.io';

const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });

io.use(adaptAxiomifyPlugin(requireAuth));

io.on('connection', (socket) => {
  // socket.data.user is what the auth plugin assigned to req.state.user
  console.log(`Connected as ${socket.data.user?.id}`);
});
```

The bridge reconstructs an `AxiomifyRequest` from the Socket.IO handshake — headers, query, ip, url — so existing plugins work without modification. When a plugin calls `res.status(401).send(null, 'Unauthorized')`, the connection is refused with a `connect_error` carrying the status code as `err.data.statusCode`.

**Restrictions:** `res.header()` is a no-op (Socket.IO middleware can't write response headers — they're set by the upgrade handler). `res.stream()` throws (streaming bodies have no meaning on an upgrade).

### Path collisions

Socket.IO claims `/socket.io/` by default. If you have an Axiomify route under that prefix, Socket.IO's upgrade handler will eat it. Either:

```ts
// Option A: move Socket.IO to a non-conflicting path.
attachSocketIO(adapter, { path: '/realtime/' });

// Option B: move your conflicting routes off /socket.io/*.
```

## Graceful shutdown

`drainOnAdapterShutdown: true` (the default) registers a callback that fires during `adapter.gracefulShutdown()`'s drain sequence:

```
SIGTERM
  ├─ stop accepting new HTTP connections (uWS listen socket closed)
  ├─ wait for in-flight HTTP requests to complete (adapter._inflight → 0)
  ├─ close Socket.IO server (this bridge's callback) — clients receive a
  │  proper `disconnect` frame instead of a TCP-level reset
  ├─ run user's onShutdown (close DB pools, flush logs, etc.)
  └─ process.exit(0)
```

`adapter.gracefulShutdown({ timeoutMs })` remains the upper bound. If the bridge's `io.close()` takes longer than that, the force-exit timer fires `exit(1)`.

Disable per-bridge if you want to manage Socket.IO's lifecycle yourself:

```ts
attachSocketIO(adapter, { drainOnAdapterShutdown: false });
// then call io.close() manually whenever appropriate
```

## Full example: chat with auth + rate limiting

```ts
import { Axiomify, z } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { createAuthPlugin } from '@axiomify/auth';
import { createRateLimitPlugin, MemoryStore } from '@axiomify/rate-limit';
import { attachSocketIO, adaptAxiomifyPlugin } from '@axiomify/socket.io';

const app = new Axiomify();
app.enableRequestId();

const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });
const connectLimit = createRateLimitPlugin({
  windowMs: 60_000,
  max: 10,
  store: new MemoryStore(),
});

// HTTP — list rooms
app.route({
  method: 'GET',
  path: '/rooms',
  plugins: [requireAuth],
  schema: { response: z.array(z.object({ id: z.string(), name: z.string() })) },
  handler: async (_req, res) => res.send([{ id: 'r1', name: 'general' }]),
});

const adapter = new NativeAdapter(app, { port: 3000 });

const io = await attachSocketIO(adapter, {
  cors: { origin: 'https://chat.example.com', credentials: true },
});

// Reuse the SAME auth plugin for Socket.IO upgrades.
io.use(adaptAxiomifyPlugin(requireAuth));
io.use(adaptAxiomifyPlugin(connectLimit));

io.on('connection', (socket) => {
  const userId = socket.data.user?.id;
  socket.emit('welcome', { userId });

  socket.on('chat', (data: { room: string; text: string }) => {
    io.to(data.room).emit('chat', { from: userId, text: data.text });
  });

  socket.on('join', (room: string) => socket.join(room));
});

adapter.gracefulShutdown({
  onShutdown: async () => {
    console.log('All Socket.IO clients disconnected; closing DB pool…');
    // close db, flush logs, etc.
  },
  timeoutMs: 15_000,
});

adapter.listen();
```

One process. One port. HTTP + Socket.IO + native WebSocket routes (`app.ws()`) all run on the same uWS event loop.

## Production checklist

- [ ] Pin `socket.io` ≥ 4.4.0 in your `package.json` (earlier versions don't ship `attachApp`).
- [ ] CORS origin list is explicit — never `'*'` in production with `credentials: true`.
- [ ] Authentication runs as `io.use(adaptAxiomifyPlugin(requireAuth))` so unauthorized clients are rejected BEFORE the upgrade completes.
- [ ] Rate-limit the connection upgrade (`io.use(adaptAxiomifyPlugin(connectLimit))`) to defend against connection-flood DOS.
- [ ] Use `@socket.io/redis-adapter` if you run multiple Node processes — Socket.IO state is per-process by default.
- [ ] Set `adapter.gracefulShutdown({ timeoutMs })` so long-lived sockets get a proper `disconnect` frame on deploy, not a TCP reset.
- [ ] Verify the Socket.IO `path:` option doesn't conflict with any HTTP route prefix.

## Limitations

- **Cannot attach to a listening adapter.** `attachSocketIO()` must run before `adapter.listen()`. uWS doesn't permit upgrade registration on a bound socket.
- **One bridge per adapter.** Multiple Socket.IO servers on the same path would collide at the WebSocket upgrade step. For namespaces, use `io.of(name)` on the single attached server.
- **No clustered transport adapter shipped here.** `@socket.io/redis-adapter` or `@socket.io/postgres-adapter` is what you want for multi-process / multi-host deployments.
- **Only supported even-numbered Node releases have uWS prebuilts.** Use Node 22 or 24 and see the [native adapter guide](./native.md) for the current support matrix.
