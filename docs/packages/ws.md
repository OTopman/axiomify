# @axiomify/ws

WebSocket support for Axiomify. Works with all adapters.

## Adapter compatibility

`WsManager` requires a raw `http.Server`. Use `getServerFromAdapter` to extract it:

```typescript
import { getServerFromAdapter, WsManager } from '@axiomify/ws';

// @axiomify/http
const server = adapter.listen(3000);
const ws = new WsManager({ server, path: '/ws' });

// @axiomify/fastify
await adapter.listen(3000);
const ws = new WsManager({ server: getServerFromAdapter(adapter), path: '/ws' });

// @axiomify/express, @axiomify/hapi — same pattern
const ws = new WsManager({ server: getServerFromAdapter(adapter), path: '/ws' });
```

## Options

| Option | Type | Default |
|---|---|---|
| `server` | `http.Server` | required |
| `path` | `string` | `/ws` |
| `heartbeatIntervalMs` | `number` | `30000` |
| `maxMessageBytes` | `number` | `65536` |
| `maxConnections` | `number` | `10000` |
| `maxBufferedBytes` | `number` | `1048576` |
| `authenticate` | `async (req) => User \| null` | — |

## Events and rooms

```typescript
ws.on('message', (client, data) => ws.broadcast('message', data));
client.join('room:general');
ws.toRoom('room:general').emit('join', { user: client.user });
```
