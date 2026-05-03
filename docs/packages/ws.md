# @axiomify/ws

WebSocket support for Axiomify. Works with all HTTP-based adapters.

## Install

```bash
npm install @axiomify/ws ws
npm install --save-dev @types/ws
```

> **Note:** For `@axiomify/native`, use the built-in WebSocket support on `NativeAdapter` instead.
> `@axiomify/ws` is for the Node.js `ws` library, which wraps the HTTP upgrade event.

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';
import { useWebSockets, getWsManager } from '@axiomify/ws';

const app = new Axiomify();
const adapter = new HttpAdapter(app);

// 1. Start the HTTP server first
const server = adapter.listen(3000);

// 2. Attach WebSocket to the same server
useWebSockets(app, {
  server,
  path: '/ws',
  maxConnections: 10_000,
  authenticate: async (req) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    return token ? verifyToken(token) : null; // return user or null
  },
});

// 3. Handle events
const ws = getWsManager<{ id: string }>(app)!;

ws.on('connect',    (client) => console.log('connected:', client.id));
ws.on('disconnect', (client) => console.log('disconnected:', client.id));
ws.on('message',    (client, type, data) => {
  if (type === 'ping') ws.send(client, { type: 'pong' });
  if (type === 'chat') ws.broadcast({ type: 'chat', from: client.id, text: data.text });
});
```

## Adapter compatibility

Use `getServerFromAdapter()` to extract the underlying `http.Server` from any adapter:

```typescript
import { getServerFromAdapter, useWebSockets } from '@axiomify/ws';

// @axiomify/express
const expressAdapter = new ExpressAdapter(app);
const server = expressAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(expressAdapter), path: '/ws' });

// @axiomify/fastify
const fastifyAdapter = new FastifyAdapter(app);
await fastifyAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(fastifyAdapter), path: '/ws' });

// @axiomify/hapi
const hapiAdapter = new HapiAdapter(app);
await hapiAdapter.listen(3000);
useWebSockets(app, { server: getServerFromAdapter(hapiAdapter), path: '/ws' });

// @axiomify/http — no helper needed, listen() returns the server directly
const httpAdapter = new HttpAdapter(app);
const server = httpAdapter.listen(3000);
useWebSockets(app, { server, path: '/ws' });
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `server` | `http.Server` | required | The HTTP server to attach WebSocket upgrades to. |
| `path` | `string` | all paths | Only accept upgrades to this path. |
| `maxConnections` | `number` | `10_000` | Reject upgrades above this limit (503 Service Unavailable). |
| `maxBufferedBytes` | `number` | `1_048_576` | Skip sends to clients with more queued bytes than this. Prevents slow consumers from growing memory. |
| `heartbeatIntervalMs` | `number` | `30_000` | Ping interval. Clients that don't pong within this window are disconnected. |
| `maxMessageBytes` | `number` | unlimited | Maximum message payload size. |
| `authenticate` | `(req) => Promise<TUser \| null>` | — | Called on upgrade. Return user data to allow, `null` to reject. |
| `onBinary` | `(client, data) => void` | — | Handler for binary (non-JSON) WebSocket frames. |

## WsManager methods

```typescript
const ws = getWsManager<MyUser>(app)!;

// Event registration
ws.on('connect',    (client) => void);
ws.on('disconnect', (client) => void);
ws.on('message',    (client, type, data) => void);

// Messaging
ws.send(client, payload);          // send to one client
ws.broadcast(payload);             // send to all connected clients
ws.broadcast(payload, 'room-1');   // send to room members only

// Rooms
ws.join(client, 'room-1');
ws.leave(client, 'room-1');

// Stats
const { connectedClients, rooms } = ws.getStats();

// Shutdown
ws.close(); // closes all connections and stops heartbeat timer
```

## Authenticated connections

```typescript
useWebSockets<{ userId: string; role: string }>(app, {
  server,
  path: '/ws',
  authenticate: async (req) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return null;
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!);
      return { userId: payload.sub as string, role: payload.role as string };
    } catch {
      return null;
    }
  },
});

ws!.on('connect', (client) => {
  console.log('User connected:', client.user?.userId);
});
```

## Rooms example

```typescript
ws!.on('message', (client, type, data) => {
  switch (type) {
    case 'join-room':
      ws!.join(client, data.room);
      ws!.send(client, { type: 'joined', room: data.room });
      break;
    case 'leave-room':
      ws!.leave(client, data.room);
      break;
    case 'room-message':
      ws!.broadcast({ type: 'room-message', from: client.id, text: data.text }, data.room);
      break;
  }
});
```

## Graceful shutdown

```typescript
process.on('SIGTERM', async () => {
  const wsManager = getWsManager(app);
  wsManager?.close();           // close all WebSocket connections
  await adapter.close();        // close the HTTP server
  process.exit(0);
});
```
