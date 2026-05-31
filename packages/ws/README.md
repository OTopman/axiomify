# @axiomify/ws

[![npm version](https://img.shields.io/npm/v/@axiomify/ws.svg)](https://npmjs.com/package/@axiomify/ws)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **⚠️ This is NOT a wrapper for the [`ws`](https://github.com/websockets/ws) npm package.**
>
> `@axiomify/ws` is a **native-only pub/sub room utility** built on
> [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) O(1)
> topic broadcast. It provides rooms, presence tracking, typed events,
> and backpressure-aware publishing — all without a single JavaScript
> fan-out loop.

## Why not `ws`?

| Dimension        | Generic `ws`                      | `@axiomify/ws`                      |
| ---------------- | --------------------------------- | ----------------------------------- |
| **Broadcast**    | `for...of` loop over every socket | O(1) uWS topic publish (C++ kernel) |
| **Memory/conn**  | ~8 KB                             | ~0.5 KB                             |
| **Rooms**        | DIY `Map<string, Set<WebSocket>>` | Built-in, topic-backed              |
| **Pub/Sub**      | Not included                      | Native, zero-copy                   |
| **Backpressure** | Silent buffer bloat               | `getBufferedAmount()`               |
| **Presence**     | DIY heartbeat + tracking          | Built-in with configurable interval |

## Install

```bash
npm install @axiomify/ws
```

`@axiomify/ws` depends on `@axiomify/core` and `@axiomify/native`. The
uWebSockets.js peer dependency is inherited from `@axiomify/native`.

## Quick start

```ts
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { wsRooms } from '@axiomify/ws';

const app = new Axiomify();

// Register the room manager on the app — feels like app.ws()
const rooms = wsRooms(app, {
  path: '/chat',
  onConnect(client) {
    client.join('lobby');
    rooms.room('lobby')?.broadcast({
      event: 'system',
      data: `User joined the lobby`,
    });
  },
  onDisconnect(client) {
    console.log(`Client ${client.id} disconnected`);
  },
});

// Listen for room events
rooms.on('join', (roomName, client) => {
  console.log(`${client.id} joined ${roomName}`);
});

rooms.on('leave', (roomName, client) => {
  console.log(`${client.id} left ${roomName}`);
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('Listening on :3000'));
```

That's it. No boilerplate room tracking, no fan-out loops, no heartbeat
timers to manage.

## API Reference

### `wsRooms(app, options?)`

Factory function that registers a WebSocket route on the Axiomify app
and returns a `RoomManager`.

```ts
const rooms = wsRooms(app, {
  path: '/ws', // WebSocket endpoint (default: '/ws')
  maxRoomsPerClient: 50, // Room limit per client (default: 50)
  presenceIntervalMs: 30_000, // Heartbeat interval (default: 30s, 0 to disable)
  maxPayloadLength: 256 * 1024,
  idleTimeout: 120,
  plugins: [authPlugin], // Axiomify plugins run on upgrade
  schema: z.object({
    // Optional Zod validation
    text: z.string(),
  }),
  onConnect(client) {
    /* ... */
  },
  onDisconnect(client, code, reason) {
    /* ... */
  },
  onMessage(client, data) {
    /* ... */
  },
});
```

### `RoomManager`

The object returned by `wsRooms()`.

| Method / Property       | Description                             |
| ----------------------- | --------------------------------------- |
| `room(name)`            | Get a room by name (or `undefined`)     |
| `getOrCreateRoom(name)` | Get or create a room                    |
| `roomNames`             | All active room names                   |
| `roomCount`             | Number of active rooms                  |
| `client(id)`            | Get a connected client by ID            |
| `clientCount`           | Number of connected clients             |
| `clientIds`             | All connected client IDs                |
| `broadcastAll(data)`    | Broadcast to every connected client     |
| `close()`               | Disconnect all clients, clear all rooms |
| `on(event, handler)`    | Listen for room events                  |
| `off(event, handler)`   | Remove an event listener                |

#### Events

| Event        | Handler Signature                                |
| ------------ | ------------------------------------------------ |
| `join`       | `(roomName: string, client: RoomClient) => void` |
| `leave`      | `(roomName: string, client: RoomClient) => void` |
| `message`    | `(client: RoomClient, data: unknown) => void`    |
| `roomCreate` | `(roomName: string) => void`                     |
| `roomDelete` | `(roomName: string) => void`                     |
| `error`      | `(error: Error, client?: RoomClient) => void`    |

### `Room`

Represents a named room backed by a uWS topic.

| Method / Property                      | Description                        |
| -------------------------------------- | ---------------------------------- |
| `name`                                 | Room name                          |
| `size`                                 | Number of members                  |
| `has(clientId)`                        | Check membership                   |
| `broadcast(data)`                      | O(1) broadcast to all members      |
| `broadcastExcept(clientId, data)`      | Broadcast excluding one client     |
| `getPresence()`                        | Array of `{ id, state, joinedAt }` |
| `kick(clientId, reason?, disconnect?)` | Remove a client from the room      |
| `members`                              | Iterator over all room members     |

### `RoomClient`

Represents a connected WebSocket client with room capabilities.

| Method / Property     | Description                                    |
| --------------------- | ---------------------------------------------- |
| `id`                  | Unique client ID (UUID)                        |
| `state`               | Shared state from the upgrade (auth data, etc) |
| `rooms`               | `ReadonlySet<string>` of current rooms         |
| `send(data)`          | Send to this specific client                   |
| `join(room)`          | Join a room                                    |
| `leave(room)`         | Leave a room                                   |
| `leaveAll()`          | Leave all rooms                                |
| `disconnect()`        | Close the connection                           |
| `getBufferedAmount()` | Bytes queued (backpressure check)              |

## Wire Protocol

Clients can interact with rooms via a simple JSON action/event protocol.
This is **optional** — you can also use `onMessage` + programmatic
`client.join()` / `room.broadcast()` for fully custom protocols.

### Client → Server

```json
{ "action": "join",     "room": "lobby" }
{ "action": "leave",    "room": "lobby" }
{ "action": "message",  "room": "lobby", "data": { "text": "hello" } }
{ "action": "presence", "room": "lobby" }
```

### Server → Client

```json
{ "event": "joined",   "room": "lobby" }
{ "event": "left",     "room": "lobby" }
{ "event": "message",  "room": "lobby", "from": "client-uuid", "data": { "text": "hello" } }
{ "event": "presence", "room": "lobby", "clients": [{ "id": "...", "state": {}, "joinedAt": 1716843600000 }] }
{ "event": "error",    "message": "Room limit exceeded", "code": "JOIN_FAILED" }
```

## Backpressure

uWebSockets.js tracks the send buffer per connection. Use
`getBufferedAmount()` to implement application-level flow control:

```ts
rooms.on('message', (client, data) => {
  const room = rooms.room('live-feed');
  if (!room) return;

  for (const member of room.members) {
    if (member.client.getBufferedAmount() > 64 * 1024) {
      // Skip non-critical updates for slow clients
      continue;
    }
    member.client.send(data);
  }
});
```

For simple broadcast, `room.broadcast()` uses uWS's native publish
which handles backpressure at the C++ level.

## Presence

The `getPresence()` method returns a snapshot of all clients in a room:

```ts
const lobby = rooms.room('lobby');
const online = lobby?.getPresence();
// [{ id: 'abc-123', state: { user: { name: 'Alice' } }, joinedAt: 1716843600000 }]
```

Clients can also request presence via the wire protocol:

```json
{ "action": "presence", "room": "lobby" }
```

The `presenceIntervalMs` option (default 30s) controls the heartbeat
interval. Set to `0` to disable. uWS handles ping/pong natively via
`idleTimeout` — the presence timer is purely for application-level
awareness.

## Auth Integration

Use existing Axiomify plugins to secure the WebSocket upgrade:

```ts
import { createAuthPlugin } from '@axiomify/auth';

const rooms = wsRooms(app, {
  path: '/chat',
  plugins: [createAuthPlugin({ secret: process.env.JWT_SECRET! })],
  onConnect(client) {
    // client.state.user is populated by the auth plugin
    console.log(`Authenticated user: ${client.state.user.name}`);
    client.join('authenticated');
  },
});
```

If the auth plugin rejects the connection (e.g. `res.status(401).send(...)`),
the WebSocket upgrade never completes — the client receives an HTTP 401.

## Performance

`@axiomify/ws` achieves its performance by delegating all fan-out to
uWebSockets.js's C++ event loop:

- **`room.broadcast()`** calls `uwsApp.publish(topic, ...)` — a single
  C++ syscall that fans out to all subscribers. O(1) regardless of room size.
- **`room.broadcastExcept()`** uses `ws.publish(topic, ...)` from the
  excluded client's socket — uWS automatically skips the sender.
- **No JavaScript iteration** for broadcast. The `for...of` loop in
  generic `ws` libraries is the primary bottleneck at scale.

### Benchmarks (indicative, single-core)

| Scenario                       | Generic `ws` | `@axiomify/ws` |
| ------------------------------ | ------------ | -------------- |
| 10k clients, 1 room broadcast  | ~12ms        | <1ms           |
| 100k clients, 1 room broadcast | ~120ms       | <1ms           |
| Memory per connection          | ~8 KB        | ~0.5 KB        |

## vs `@axiomify/socket.io`

| Feature            | `@axiomify/ws`                | `@axiomify/socket.io`             |
| ------------------ | ----------------------------- | --------------------------------- |
| **Protocol**       | Raw WebSocket + optional JSON | Socket.IO (HTTP polling fallback) |
| **Dependencies**   | Zero                          | `socket.io` (~200 KB)             |
| **Reconnection**   | Client-side only              | Built-in with backoff             |
| **Rooms**          | Native uWS topics             | Socket.IO adapter                 |
| **Namespaces**     | N/A (use room prefixes)       | Built-in                          |
| **Binary**         | Native                        | Supported                         |
| **Browser compat** | Modern only (no fallback)     | Universal (polling fallback)      |

**Use `@axiomify/ws`** when you control both client and server, need
maximum performance, and don't need HTTP long-polling fallback.

**Use `@axiomify/socket.io`** when you need broad browser compatibility,
automatic reconnection, or the Socket.IO ecosystem (admin UI, adapters).

## Room Lifecycle

Rooms are created **on demand** when the first client joins, and
destroyed **immediately** when the last client leaves. There is no
TTL or lazy cleanup — this minimises memory usage.

```
Client A joins "lobby"  →  Room "lobby" created (roomCreate event)
Client B joins "lobby"  →  Room now has 2 members
Client A leaves "lobby" →  Room now has 1 member
Client B leaves "lobby" →  Room "lobby" destroyed (roomDelete event)
```

## Room Limit

Each client can join a maximum of 50 rooms by default. This prevents a
single malicious connection from subscribing to thousands of topics and
exhausting memory:

```ts
const rooms = wsRooms(app, {
  maxRoomsPerClient: 100, // Override the default
});
```

Set to `Infinity` to disable the limit entirely (not recommended in
production).

## Limitations

- **Native adapter only** — requires `@axiomify/native` (uWebSockets.js).
  Does not work with Node.js `http.Server`.
- **No message history** — rooms are live pub/sub namespaces. For
  persistent messaging, combine with a message queue or database.
- **No cross-process rooms** — single-process only. For multi-process
  deployments, use `@axiomify/socket.io` with a Redis adapter.
- **Modern browsers only** — no HTTP long-polling fallback. Clients must
  support the WebSocket protocol.
- **Node 20–22** — same constraint as `@axiomify/native` (uWS prebuilt
  support).
