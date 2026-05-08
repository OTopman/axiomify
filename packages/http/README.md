# @axiomify/http

[![npm version](https://img.shields.io/npm/v/@axiomify/http.svg)](https://npmjs.com/package/@axiomify/http)

Node.js native HTTP adapter for Axiomify. Zero external dependencies. 32,841 req/s single-core, 57,200 req/s at 2 workers (160% scaling, SO_REUSEPORT).

## Install

```bash
npm install @axiomify/http @axiomify/core zod
```

## Quick example

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

// Single process
const server = new HttpAdapter(app).listen(3000, () => console.log('Ready'));

// Multi-core
const adapter = new HttpAdapter(app, { workers: 4 });
adapter.listenClustered(3000, {
  onPrimary: (pids) => console.log('Workers:', pids),
});
```

## Documentation

See [docs/packages/http.md](../../docs/packages/http.md).
