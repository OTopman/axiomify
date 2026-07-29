# @axiomify/ws

A native, zero-dependency pub/sub room and presence utility for `@axiomify/native`.

> [!IMPORTANT]
> **This is NOT a wrapper for the standard `ws` npm package.** It is a high-level room/presence abstraction that builds on top of `@axiomify/native`'s existing WebSocket engine, leveraging uWebSockets.js's native C++ topic pub/sub for O(1) broadcast performance.

---

## Why Use This?

In traditional Node.js WebSocket frameworks, broadcasting a message to a room requires a JavaScript loop:

```js
// Traditional O(N) JavaScript loop:
for (const client of room.clients) {
  client.send(message);
}
```

If a room has 50,000 users, Node.js must loop, serialize, queue, and push 50,000 frames individually in JavaScript, locking up the single-threaded event loop.

`@axiomify/ws` delegates this entirely to the kernel/C++ layer of `uWebSockets.js` using native topic pub/sub. Broadcasting to a room of 50,000 users runs at O(1) complexity relative to the JavaScript thread:

```ts
// Native O(1) C++ broadcast:
room.broadcast(message);
```

---

## Install

```bash
npm install @axiomify/ws
```

`uWebSockets.js` (installed as part of `@axiomify/native`) is a peer dependency.

---

## Quick Start

```ts
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { wsRooms } from '@axiomify/ws';
import { z } from 'zod';

const app = new Axiomify();

// Register the room manager at /chat
const rooms = wsRooms(app, {
  path: '/chat',
  schema: z.object({
    action: z.string(),
    room: z.string().optional(),
    data: z.any().optional(),
  }),
  onConnect(client) {
    // Send a welcome message to the connecting client
    client.send({ event: 'welcome', id: client.id });
  },
  onMessage(client, data) {
    // Custom message handling or wire protocol parsing
  },
});

// Listen to room manager events
rooms.on('join', (roomName, client) => {
  console.log(`Client ${client.id} joined room ${roomName}`);
});

rooms.on('leave', (roomName, client) => {
  console.log(`Client ${client.id} left room ${roomName}`);
});

const adapter = new NativeAdapter(app, { port: 3000 });
adapter.listen(() => console.log('WebSocket Room Server listening on :3000'));
```

---

## Wire Protocol

`@axiomify/ws` has an **opt-in wire protocol** that processes incoming client text frames automatically. If the client sends a JSON payload matching the `ClientAction` schema, it is processed automatically.

### Client Actions (Client → Server)

#### Join a Room

```json
{
  "action": "join",
  "room": "gaming"
}
```

_Triggers the `join` event and subscribes the client socket to the `gaming` topic._

#### Leave a Room

```json
{
  "action": "leave",
  "room": "gaming"
}
```

_Triggers the `leave` event and unsubscribes the client._

#### Send a Room Message

```json
{
  "action": "message",
  "room": "gaming",
  "data": {
    "text": "Hello world!"
  }
}
```

_Broadcasts the message natively to all members of the `gaming` room (excluding the publisher at the C++ level, and loop-backed to the publisher client via JS)._

#### Query Room Presence

```json
{
  "action": "presence",
  "room": "gaming"
}
```

_Queries the server for the current presence list in the specified room._

### Server Events (Server → Client)

#### Joined Room

```json
{
  "event": "joined",
  "room": "gaming"
}
```

#### Left Room

```json
{
  "event": "left",
  "room": "gaming"
}
```

#### Message Received

```json
{
  "event": "message",
  "room": "gaming",
  "from": "client-id-here",
  "data": {
    "text": "Hello world!"
  }
}
```

#### Room Presence List

```json
{
  "event": "presence",
  "room": "gaming",
  "clients": [
    {
      "id": "client-1",
      "state": { "user": "Alice" },
      "joinedAt": 1716847200000
    },
    { "id": "client-2", "state": { "user": "Bob" }, "joinedAt": 1716847215000 }
  ]
}
```

#### Error Frame

```json
{
  "event": "error",
  "code": "JOIN_FAILED",
  "message": "Room limit exceeded"
}
```

Or for unauthorized room join attempts (default-deny when no allowlist matches):

```json
{
  "error": "Unauthorized",
  "code": "ROOM_JOIN_FORBIDDEN"
}
```

---

## API Reference

### `wsRooms(app, options)`

Registers a WebSocket route and returns a `RoomManager` instance.

#### Options

| Option               | Type                                                    | Default             | Description                                                                                                                                |
| -------------------- | ------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`               | `string`                                                | `'/ws'`             | WebSocket upgrade endpoint.                                                                                                                |
| `maxRoomsPerClient`  | `number`                                                | `50`                | Max rooms a single client can join to prevent memory abuse.                                                                                |
| `presenceIntervalMs` | `number`                                                | `30000`             | Heartbeat interval. Use `0` to disable.                                                                                                    |
| `maxPayloadLength`   | `number`                                                | `262144`            | Max payload size in bytes (256 KB).                                                                                                        |
| `compression`        | `number`                                                | `SHARED_COMPRESSOR` | Compression behavior.                                                                                                                      |
| `idleTimeout`        | `number`                                                | `120`               | uWS connection idle timeout in seconds.                                                                                                    |
| `plugins`            | `RouteMiddleware[]`                                     | `[]`                | Axiomify upgrade-level plugins (e.g. for authentication).                                                                                  |
| `schema`             | `ZodTypeAny`                                            | `undefined`         | Zod schema for automatic incoming frame validation.                                                                                        |
| `sanitize`           | `boolean \| object`                                     | `true`              | Enable security sanitization (XSS, Prototype Pollution, Null Byte) on incoming messages. Requires `@axiomify/security` to be installed.    |
| `beforeJoin`         | `(client, room: string) => boolean \| Promise<boolean>` | `undefined`         | Optional authorization check before joining a room. Return true to allow, false/throw to deny.                                             |
| `allowlist`          | `RegExp`                                                | `undefined`         | Optional room name allowlist pattern (used if `beforeJoin` is not registered). By default, all joins are denied if neither option matches. |
| `onConnect`          | `(client) => void`                                      | `undefined`         | Callback fired when a new client connects.                                                                                                 |
| `onDisconnect`       | `(client, code, reason) => void`                        | `undefined`         | Callback fired when a client disconnects.                                                                                                  |
| `onMessage`          | `(client, data) => void`                                | `undefined`         | Callback fired on every validated incoming frame.                                                                                          |

---

### `RoomManager`

#### Properties

- `roomCount: number` — Total number of active rooms.
- `roomNames: string[]` — Array of all active room names.
- `clientCount: number` — Total number of connected clients.
- `clientIds: string[]` — Array of all connected client IDs.

#### Methods

- `room(name: string): Room | undefined` — Get an active room.
- `getOrCreateRoom(name: string): Room` — Get or create a room instance.
- `client(id: string): RoomClient | undefined` — Get a connected client by ID.
- `broadcastAll(data: string | Buffer | object, isBinary?: boolean): void` — Send a message to every connected client on the server.
- `close(): void` — Shut down the room manager, disconnecting all clients.

#### Events

- `'join'` `(roomName: string, client: RoomClient) => void` — Fired when a client joins a room.
- `'leave'` `(roomName: string, client: RoomClient) => void` — Fired when a client leaves a room.
- `'message'` `(client: RoomClient, data: unknown) => void` — Fired when a message is received from a client.
- `'roomCreate'` `(roomName: string) => void` — Fired when a new room is created.
- `'roomDelete'` `(roomName: string) => void` — Fired when a room is destroyed (empty).
- `'error'` `(err: Error, client?: RoomClient) => void` — Fired on protocol or middleware errors.

---

### `Room`

#### Properties

- `name: string` — The room name / topic name.
- `size: number` — Count of clients in the room.
- `createdAt: number` — Creation timestamp (ms).
- `clientIds: string[]` — Client IDs in this room.

#### Methods

- `broadcast(data: string | Buffer | object, isBinary?: boolean): void` — Broadcasts natively to all room members (O(1) complexity).
- `broadcastExcept(excludeClientId: string, data: string | Buffer | object, isBinary?: boolean): void` — Broadcasts natively to everyone in the room except the excluded client.
- `has(clientId: string): boolean` — Membership check.
- `getPresence(): Presence[]` — Returns presence metadata.
- `kick(clientId: string, reason?: string, disconnect?: boolean): boolean` — Forcefully evict a client from the room. Returns `true` if the client was found and evicted.

---

### `RoomClient`

#### Properties

- `id: string` — Unique UUID v4 client ID.
- `state: Record<string, any>` — Mutable state carried from the upgrade handshake (e.g. `client.state.user`).
- `rooms: ReadonlySet<string>` — Read-only set of room names this client is a member of.

#### Methods

- `send(data: string | Buffer | object, isBinary?: boolean): boolean` — Send a message to this specific client.
- `join(roomName: string): void` — Join a room.
- `leave(roomName: string): void` — Leave a room.
- `leaveAll(): void` — Leave all rooms.
- `disconnect(): void` — Gracefully disconnect the socket connection.
- `getBufferedAmount(): number` — Bytes currently buffered in the native send queue (useful for backpressure management).

## Scaling across processes

uWS topic broadcast is per-process. Under `listenClustered()` (SO_REUSEPORT)
each worker holds its own room state, so two clients in the same room but on
different workers never see each other's messages. A `WsBroker` bridges the
workers:

```ts
import Redis from 'ioredis';
import { wsRooms, RedisWsBroker } from '@axiomify/ws';

const pub = new Redis();
const sub = new Redis(); // subscriber connections are dedicated in Redis

const rooms = wsRooms(app, {
  path: '/chat',
  broker: new RedisWsBroker({ pub, sub }),
});
```

`RedisWsBroker` duck-types both `ioredis` and `redis@4` (node-redis) clients —
no Redis dependency is added; you inject your own. For tests or single-node
semantic parity, `MemoryWsBroker` connects managers in-process:

```ts
import { createMemoryBrokerHub, MemoryWsBroker } from '@axiomify/ws';
const hub = createMemoryBrokerHub();
const brokerA = new MemoryWsBroker(hub); // node A
const brokerB = new MemoryWsBroker(hub); // node B
```

How it works:

- Public room broadcasts are delivered locally via the uWS topic first, then
  forwarded to `axiomify:ws:room:<room>`. Messages arriving from the broker
  re-enter through a local-only path — no echo loops, exactly-once delivery
  per node. Binary frames travel base64-encoded (documented cost).
- Room channels are subscribed lazily on the first local join and dropped
  after the last local leave (local membership is the refcount).
- `manager.getGlobalPresence(room)` aggregates presence over a control
  channel (`axiomify:ws:ctl`) with a fixed 250 ms collection window. It is a
  best-effort, eventually-consistent snapshot: nodes slower than the window
  are missing from the count, and there is no node registry. Without a
  broker it degrades to the local view.
- Broker failures never break the local message path: delivery proceeds,
  the error surfaces on the manager's `error` event, and
  `getStats().brokerDropped` counts the misses.
- `manager.close()` also closes the broker.
