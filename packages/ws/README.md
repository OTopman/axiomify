# @axiomify/ws

WebSocket support for Axiomify. Works with all adapters via the `getServerFromAdapter()` helper.

## Install

```bash
npm install @axiomify/ws ws
npm install --save-dev @types/ws
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';
import { useWebSockets, getWsManager } from '@axiomify/ws';

const app = new Axiomify();
const adapter = new HttpAdapter(app);

// 1. Start the HTTP server
const server = adapter.listen(3000);

// 2. Attach WebSocket support
useWebSockets(app, {
  server,
  path: '/ws',
  maxConnections: 10_000,
  heartbeatIntervalMs: 30_000,
  authenticate: async (req) => {
    const token = req.headers['authorization'];
    // return user object or null to reject the connection
    return token ? { id: 'user-1' } : null;
  },
});

// 3. Use the manager
const ws = getWsManager(app);

ws!.on('message', (client, type, data) => {
  if (type === 'chat') {
    ws!.broadcast({ type: 'chat', from: client.id, text: data.text });
  }
});
```

## Using with Express, Fastify, or Hapi

Use `getServerFromAdapter()` to extract the underlying `http.Server`:

```typescript
import { getServerFromAdapter, useWebSockets } from '@axiomify/ws';

// Express
const expressAdapter = new ExpressAdapter(app);
const server = expressAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(expressAdapter), path: '/ws' });

// Fastify
const fastifyAdapter = new FastifyAdapter(app);
await fastifyAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(fastifyAdapter), path: '/ws' });

// Hapi
const hapiAdapter = new HapiAdapter(app);
await hapiAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(hapiAdapter), path: '/ws' });
```

> **Note:** `@axiomify/native` (uWebSockets.js) has built-in WebSocket support via
> the `ws` option on `NativeAdapter`. Do not use `@axiomify/ws` with native — use
> the native adapter's own WebSocket API instead.

## Options

| Option | Default | Description |
|---|---|---|
| `server` | required | The `http.Server` to attach upgrade listeners to. |
| `path` | `undefined` | Only handle upgrades to this path. All paths accepted if omitted. |
| `maxConnections` | `10_000` | Reject upgrades when this limit is reached (503). |
| `maxBufferedBytes` | `1_048_576` | Skip broadcasts to clients with more than this many queued bytes. |
| `heartbeatIntervalMs` | `30_000` | Ping interval. Disconnects unresponsive clients. |
| `maxMessageBytes` | `unlimited` | Maximum message payload size in bytes. |
| `authenticate` | — | Called on upgrade. Return a user object to allow, `null` to reject (401). |
| `onBinary` | — | Handler for binary (non-JSON) messages. |

## WsManager API

```typescript
const ws = getWsManager<{ id: string }>(app)!;

// Event handlers
ws.on('connect',    (client) => console.log('connected:', client.id));
ws.on('disconnect', (client) => console.log('disconnected:', client.id));
ws.on('message',    (client, type, data) => { /* handle typed events */ });

// Rooms
ws.join(client, 'room-1');
ws.leave(client, 'room-1');
ws.broadcast({ type: 'update' }, 'room-1'); // broadcast to room only
ws.broadcast({ type: 'global' });            // broadcast to all clients

// Individual send
ws.send(client, { type: 'welcome', message: 'Hello!' });

// Stats
const { connectedClients, rooms } = ws.getStats();

// Graceful shutdown
ws.close(); // closes all connections cleanly
```

## Validation with Zod

```typescript
import { z } from 'zod';

const chatSchema = z.object({
  type: z.literal('chat'),
  text: z.string().max(1000),
});

ws.on('message', (client, type, data) => {
  const parsed = chatSchema.safeParse({ type, ...data });
  if (!parsed.success) return;
  ws.broadcast(parsed.data, 'chat-room');
});
```
