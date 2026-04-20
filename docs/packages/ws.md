# @axiomify/ws

WebSocket management with schema validation and room support.

## Install

```bash
npm install @axiomify/ws ws zod
```

## Exports

- `useWebSockets(app, options)`
- `WsManager`

## Options

- `server`
- `path`
- `heartbeatIntervalMs`
- `maxMessageBytes`
- `authenticate`
- `onBinary`

`server` is a Node `http.Server`, not a `ws.Server`.

## Example

```ts
const adapter = new ExpressAdapter(app);
const server = adapter.listen(3000);

useWebSockets(app, {
  server,
  path: '/ws',
  authenticate: async (_req) => ({ id: 'user-1' }),
});

const ws = (app as any).ws as WsManager;

ws.on(
  'chat:message',
  z.object({ room: z.string(), text: z.string() }),
  (client, data) => {
    ws.joinRoom(client, data.room);
    ws.broadcastToRoom(data.room, 'chat:message', {
      sender: client.user?.id,
      text: data.text,
    });
  },
);
```

## Features

- per-event Zod validation
- room join and leave support
- room broadcast support
- heartbeat and termination of dead clients
- optional binary frame handling
