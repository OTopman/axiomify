# @axiomify/ws

Schema-first WebSocket management with Zod validation, room/broadcast support, and per-client heartbeat.

## Installation

```bash
npm install @axiomify/ws
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { useWebSockets } from '@axiomify/ws';
import { z } from 'zod';

const app = new Axiomify();

// Create and attach WebSocket server
import WebSocket from 'ws';
const wss = new WebSocket.Server({ noServer: true });

useWebSockets(app, {
  server: wss,
  heartbeatIntervalMs: 30_000, // 30 seconds
  maxMessageBytes: 65_536,     // 64KB max message size
});

// Register message handlers with Zod validation
const ws = app.ws;

ws.on(
  'chat:message',
  z.object({ text: z.string().min(1).max(1000) }),
  (client, data) => {
    // data.text is type-safe: string
    console.log(`User said: ${data.text}`);
    
    // Broadcast to everyone in the 'chat' room
    ws.broadcastToRoom('chat', 'chat:message', {
      user: client.user?.id,
      text: data.text,
      timestamp: Date.now(),
    });
  }
);

// Handle binary frames (e.g., images, audio)
useWebSockets(app, {
  server: wss,
  onBinary: (client, buffer) => {
    console.log(`Received ${buffer.byteLength} bytes`);
  },
});
```

## Features

- **Zod Validation**: Automatic schema validation for all message types
- **Type-Safe**: Full TypeScript inference on message payloads
- **Rooms & Broadcasting**: Built-in room management and per-room broadcasts
- **Heartbeat**: Automatic heartbeat/pong tracking; client termination on timeout
- **Message Size Limits**: Configurable max message size with automatic rejection
- **Binary Frames**: Optional handler for non-JSON frames (images, audio, etc.)
- **Per-Client User**: Automatic `client.user` augmentation from auth plugin

## API Reference

### `useWebSockets(app, options)`

Registers WebSocket server on the app.

**Options:**

```typescript
interface WebSocketOptions {
  server: WebSocket.Server;                   // Your ws.Server instance
  heartbeatIntervalMs?: number;              // Default: 30000 (30s)
  maxMessageBytes?: number;                  // Default: 65536 (64KB)
  onBinary?: (client: WsClient, data: Buffer) => void; // Binary frame handler
  onError?: (err: Error) => void;             // Error handler
}
```

### `app.ws.on(event, schema?, handler)`

Register a message handler with optional validation.

**Parameters:**

```typescript
ws.on(
  'event:name',                           // Event name
  z.object({ /* schema */ }) || null,     // Zod schema (null = no validation)
  (client, data) => {                     // Handler
    // client: WsClient
    // data: validated payload
  }
);
```

### `app.ws.broadcastToRoom(room, event, data)`

Send a message to all clients in a room.

```typescript
ws.broadcastToRoom('chat', 'chat:message', {
  user: 'alice',
  text: 'Hello, world!',
});
```

### `app.ws.joinRoom(client, room)`

Add a client to a room.

```typescript
ws.joinRoom(client, 'chat');
```

### `app.ws.leaveRoom(client, room)`

Remove a client from a room.

```typescript
ws.leaveRoom(client, 'chat');
```

### `app.ws.getStats()`

Get current WebSocket stats.

```typescript
const stats = ws.getStats();
console.log(stats);
// {
//   connectedClients: 42,
//   rooms: { 'chat': 5, 'notifications': 38 },
//   uptime: 3600000
// }
```

## Examples

### Chat Application

```typescript
useWebSockets(app, { server: wss });
const ws = app.ws;

ws.on(
  'chat:message',
  z.object({
    text: z.string().min(1).max(500),
    room: z.string(),
  }),
  (client, data) => {
    // Ensure client is in the room
    ws.joinRoom(client, data.room);
    
    // Broadcast to all in the room
    ws.broadcastToRoom(data.room, 'chat:message', {
      user: client.user?.id || 'anonymous',
      text: data.text,
      timestamp: Date.now(),
    });
  }
);

// Handle disconnection
ws.on('connection', null, (client) => {
  // Auto-cleanup on close is handled internally
});
```

### Notifications Hub

```typescript
useWebSockets(app, { server: wss });
const ws = app.ws;

// Subscribe user to their notification room
ws.on(
  'notifications:subscribe',
  z.object({ userId: z.string() }),
  (client, data) => {
    ws.joinRoom(client, `user:${data.userId}`);
  }
);

// Publish a notification from your API
app.route({
  method: 'POST',
  path: '/notifications/send',
  plugins: [requireAuth],
  schema: {
    body: z.object({ userId: z.string(), message: z.string() }),
  },
  handler: async (req, res) => {
    const { userId, message } = req.body;
    ws.broadcastToRoom(`user:${userId}`, 'notification', {
      message,
      timestamp: Date.now(),
    });
    return res.send({ sent: true });
  },
});
```

### Schema-First Validation

```typescript
const MessageSchema = z.object({
  type: z.enum(['text', 'image', 'reaction']),
  content: z.string().max(1000),
  threadId: z.string().uuid(),
});

ws.on('message:send', MessageSchema, (client, data) => {
  // data is type-safe: { type: 'text' | 'image' | 'reaction', content: string, threadId: string }
  
  if (data.type === 'text') {
    console.log(`Text: ${data.content}`);
  } else if (data.type === 'image') {
    console.log(`Image URL: ${data.content}`);
  }
});
```

### Binary Frames (Audio/Video)

```typescript
useWebSockets(app, {
  server: wss,
  onBinary: (client, buffer) => {
    // Process binary data (e.g., audio chunks)
    console.log(`Received ${buffer.byteLength} bytes`);
    
    // Could be: audio stream, video frame, image data, etc.
    // Your app handles parsing
  },
});

// Client sends binary:
// const audio = new Uint8Array(...);
// socket.send(audio);
```

### Error Handling

```typescript
ws.on(
  'math:calculate',
  z.object({ a: z.number(), b: z.number() }),
  (client, data) => {
    try {
      const result = data.a + data.b;
      client.send(JSON.stringify({ result }));
    } catch (err) {
      client.send(JSON.stringify({ error: 'Calculation failed' }));
    }
  }
);

// Validation errors are sent to the client automatically:
// {
//   "error": "Validation failed",
//   "details": { /* Zod error format */ }
// }
```

### With Authentication

```typescript
import { createAuthPlugin } from '@axiomify/auth';

const requireAuth = createAuthPlugin({ secret: 'your-secret' });
useWebSockets(app, { server: wss });
const ws = app.ws;

ws.on(
  'secure:data',
  z.object({ secret: z.string() }),
  (client, data) => {
    // client.user is automatically populated from the auth plugin!
    console.log(`Authenticated user: ${client.user?.id}`);
  }
);
```

## WsClient Properties

Clients connected via WebSocket have these properties:

```typescript
interface WsClient {
  id: string;                // UUID
  user?: AxiomifyRequest['user'];  // From auth plugin
  rooms: Set<string>;        // Rooms this client is in
  on(event, handler);        // Native WebSocket.on
  send(message);             // Send JSON
  close(code?, reason?);     // Close connection
  terminate();               // Force disconnect
  ping();                    // Send ping frame
  isAlive?: boolean;         // Heartbeat tracking
}
```

## Heartbeat & Connection Management

The WebSocket plugin automatically:

1. **Sends periodic pings** (every `heartbeatIntervalMs`, default 30s)
2. **Tracks pongs** — records timestamp of last pong
3. **Terminates stale clients** — if 2× heartbeat interval elapses without pong, calls `terminate()`
4. **Cleans up on close** — removes client from all rooms, clears timers

This prevents zombie connections and resource leaks.

## Performance Considerations

1. **Message Size**: Default 64KB limit. Increase if needed:
   ```typescript
   useWebSockets(app, {
     server: wss,
     maxMessageBytes: 1_000_000, // 1MB
   });
   ```

2. **Heartbeat Interval**: Balance between quick stale detection and server load:
   ```typescript
   // For real-time apps (chat, gaming)
   heartbeatIntervalMs: 15_000, // 15s
   
   // For long-polling apps
   heartbeatIntervalMs: 60_000, // 60s
   ```

3. **Broadcast Scaling**: `broadcastToRoom` is O(n) where n = clients in room. For high-frequency broadcasts to large rooms, consider:
   - Redis Pub/Sub for multi-server broadcasting
   - Message batching/debouncing on the client
   - Targeted broadcasts (subset of clients)

## Testing

```typescript
import WebSocket from 'ws';

it('sends and receives messages', async () => {
  const ws = new WebSocket('ws://localhost:3000/ws');
  
  await new Promise(resolve => ws.on('open', resolve));
  
  ws.send(JSON.stringify({
    event: 'chat:message',
    data: { text: 'hello' },
  }));
  
  const message = await new Promise(resolve => {
    ws.on('message', (data) => resolve(JSON.parse(data)));
  });
  
  expect(message.event).toBe('chat:message');
  expect(message.data.text).toBe('hello');
});

it('rejects invalid messages', async () => {
  const ws = new WebSocket('ws://localhost:3000/ws');
  
  ws.send(JSON.stringify({
    event: 'chat:message',
    data: { text: '' }, // Empty text (fails min(1))
  }));
  
  const error = await new Promise(resolve => {
    ws.on('message', (data) => resolve(JSON.parse(data)));
  });
  
  expect(error.error).toBe('Validation failed');
});
```

## Deployment Notes

1. **Sticky Sessions**: If using multiple servers, ensure clients reconnect to the same server (sticky sessions in load balancer).
   
   Alternatively, use Redis Pub/Sub for cross-server broadcasts:
   ```typescript
   // Publish room messages to Redis so other servers can relay
   ```

2. **Proxy Compatibility**: Verify your reverse proxy (nginx, HAProxy) supports WebSocket upgrades:
   ```nginx
   # nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

3. **Monitoring**: Use `getStats()` to monitor connection health:
   ```typescript
   setInterval(() => {
     const { connectedClients, rooms } = ws.getStats();
     console.log(`Connected: ${connectedClients}, Rooms: ${Object.keys(rooms).length}`);
   }, 60_000);
   ```

## License

MIT
