# @axiomify/fastify

[![npm version](https://img.shields.io/npm/v/@axiomify/fastify.svg)](https://npmjs.com/package/@axiomify/fastify)

Fastify 5 adapter for Axiomify. 31,334 req/s single-core, 35,200 req/s at 2 workers (165% scaling, SO_REUSEPORT).

## Install

```bash
npm install @axiomify/fastify @axiomify/core fastify zod
```

## Quick example

```typescript
import { Axiomify } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

const adapter = new FastifyAdapter(app);
await adapter.listen(3000);

// Multi-core
const clustered = new FastifyAdapter(app, { workers: 4 });
clustered.listenClustered(3000, {
  onPrimary: (pids) => console.log('Workers:', pids),
});
```

## Documentation

See [docs/packages/fastify.md](../../docs/packages/fastify.md).
