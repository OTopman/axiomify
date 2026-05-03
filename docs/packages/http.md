# @axiomify/http

The native Node.js HTTP adapter. Zero external dependencies — routes are registered once with Axiomify's radix-trie router. No double routing.

## Install

```bash
npm install @axiomify/http @axiomify/core zod
```

## API

- `new HttpAdapter(app, options?)` — create adapter
- `adapter.listen(port, callback?)` → `http.Server`
- `adapter.listenClustered(port, opts)` — fork N worker processes (SO_REUSEPORT equivalent via Node.js cluster)
- `adapter.close()` → `Promise<void>`

## Options

| Option | Type | Default |
|---|---|---|
| `bodyLimitBytes` | `number` | `1048576` |
| `trustProxy` | `boolean` | `false` |
| `workers` | `number` | `os.cpus().length` |

## Multi-core

```typescript
const adapter = new HttpAdapter(app, { workers: 4 });
adapter.listenClustered(3000, {
  onWorkerReady: (port) => console.log(`[${process.pid}] :${port}`),
  onPrimary: (pids) => console.log('Workers:', pids),
});
```

## Routing

Routes are looked up once in Axiomify's router. The matched route and params are passed directly to `handleMatchedRoute` — `core.handle()` is never called. 404/405 are detected via the same single lookup.
