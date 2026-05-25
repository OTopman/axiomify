# @axiomify/socket.io


[![npm version](https://img.shields.io/npm/v/@axiomify/socket.io.svg)](https://npmjs.com/package/@axiomify/socket.io)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@axiomify/socket.io.svg)](https://npmjs.com/package/@axiomify/socket.io)

Socket.IO 4.4+ bridge for `@axiomify/native`. One uWS listener serves
your HTTP routes, native WebSocket routes, and Socket.IO — no second
process, no proxy, no port juggling.

## Install

```bash
npm install @axiomify/socket.io socket.io
```

`socket.io` is a peer dependency; use ≥ 4.4.0 (earlier versions lack
`attachApp(uWSApp)`).

## Quick start

```ts
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { attachSocketIO } from '@axiomify/socket.io';

const app = new Axiomify();
const adapter = new NativeAdapter(app, { port: 3000 });

// MUST run before adapter.listen() — uWS rejects route changes on a
// listening socket. attachSocketIO is async because it dynamic-imports
// socket.io (which keeps the install footprint clean for projects that
// don't need this bridge).
const io = await attachSocketIO(adapter, {
  cors: { origin: 'https://app.example.com' },
});

io.on('connection', (socket) => {
  socket.emit('welcome');
  socket.on('chat', (msg) => io.emit('chat', msg));
});

adapter.listen();
```

The returned `io` is a stock `socket.io` `Server` instance — every API
you know works as-is.

## Reusing Axiomify plugins as Socket.IO middleware

Auth, rate-limit, and fingerprint plugins all work as `io.use(...)`
middleware via the adapter helper:

```ts
import { createAuthPlugin } from '@axiomify/auth';
import { adaptAxiomifyPlugin } from '@axiomify/socket.io';

const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });

io.use(adaptAxiomifyPlugin(requireAuth));

io.on('connection', (socket) => {
  console.log('user', socket.data.user); // assigned by the auth plugin
});
```

If the plugin calls `res.status(401).send(null, 'Unauthorized')`,
Socket.IO refuses the connection with a `connect_error` carrying
`err.data.statusCode = 401`.

## Graceful shutdown

`drainOnAdapterShutdown` (default `true`) wires Socket.IO's `io.close()`
into the adapter's drain sequence:

```ts
adapter.gracefulShutdown({
  timeoutMs: 15_000,
  onShutdown: async () => {
    // Runs AFTER all Socket.IO clients have disconnected — safe to
    // close the DB pool, flush logs, release leases.
  },
});
```

Without the bridge, long-lived sockets get a TCP reset on `process.exit`.
With it, they receive a proper `disconnect` frame.

## Full reference

See [docs/[./packages/socket.io.md](./packages/socket.io.md)](https://github.com/OTopman/axiomify/blob/main/docs/packages/socket.io.md) for the
complete API, production checklist, and a chat-with-auth example.

## Limitations

- Must be called BEFORE `adapter.listen()`.
- One bridge per adapter — use `io.of(name)` for namespaces.
- No clustered transport included; use `@socket.io/redis-adapter` or
  `@socket.io/postgres-adapter` for multi-process deployments.
- Node 18-22 only (uWS prebuilt support; same constraint as
  `@axiomify/native`).
