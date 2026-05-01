# @axiomify/ws

WebSocket manager for Axiomify with optional auth, schema validation, rooms, and heartbeat.

## Install

```bash
npm i @axiomify/ws
```

## Usage

```ts
import { useWebSockets, WsManager } from '@axiomify/ws';

type User = { id: string; role: 'user' | 'admin' };

useWebSockets<User>(app, {
  server,
  path: '/ws',
  maxConnections: 10_000, // default if omitted
  authenticate: async (req) => {
    // return user object or null
    return { id: 'u1', role: 'user' };
  },
});

const ws = app.ws! as WsManager<User>;
```

## Notes

- Default connection cap is **10,000**. Set a higher number (or `Infinity`) explicitly if needed.
- Upgrades beyond the cap are rejected with `503 Service Unavailable`.
- `client.user` is typed from `useWebSockets<TUser>()`.
