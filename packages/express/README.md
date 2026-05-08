# @axiomify/express

Express.js adapter for Axiomify. Uses Express's own router for all routing — no double routing.

## Install

```bash
npm install @axiomify/express @axiomify/core express zod
npm install --save-dev @types/express
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({ name: z.string().min(1), email: z.string().email() }),
  },
  handler: async (req, res) => {
    res.status(201).send({ id: '1', ...req.body });
  },
});

const adapter = new ExpressAdapter(app);
adapter.listen(3000, () => console.log('Express on :3000'));
```

## Options

```typescript
new ExpressAdapter(app, {
  bodyLimit: '1mb',    // enforced on the actual stream — not just Content-Length
  trustProxy: false,   // set 1 for one proxy hop (nginx/ALB), 2 for two
});
```

| Option | Default | Description |
|---|---|---|
| `bodyLimit` | `'1mb'` | Maximum body size. Accepts Express-style strings (`'1mb'`, `'512kb'`). |
| `trustProxy` | `false` | Set to `1` (or IP string) when behind a reverse proxy to get correct `req.ip`. |

## Multi-core clustering

```typescript
import { ExpressAdapter } from '@axiomify/express';

const adapter = new ExpressAdapter(app, { workers: 4 });
adapter.listenClustered(3000, {
  onWorkerReady: (port) => console.log(`[${process.pid}] :${port}`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} died`),
});
```

## Accessing the native Express app

```typescript
const adapter = new ExpressAdapter(app);
const expressApp = adapter.native; // full Express Application instance

// Add Express-native middleware
expressApp.use(require('compression')());
expressApp.use(require('morgan')('combined'));
```

## Express middleware via adaptMiddleware

Use standard Express/Connect middleware on individual routes:

```typescript
import { adaptMiddleware } from '@axiomify/native'; // works on any adapter
import helmet from 'helmet';

app.route({
  method: 'GET',
  path: '/secure',
  plugins: [adaptMiddleware(helmet())],
  handler: async (_req, res) => res.send({ ok: true }),
});
```

## Routing

Routes are registered directly with Express's router — `app.get()`, `app.post()`, etc. Axiomify's router is consulted **only** in the 404/405 fallback to distinguish the two cases. Normal requests never go through two routers.

## When to use @axiomify/express

- Incrementally adopting Axiomify in an existing Express codebase
- Need Express-specific middleware (`express-session`, `passport`, etc.)
- Maximum npm ecosystem compatibility

For new projects, prefer `@axiomify/fastify` (3× higher throughput) or `@axiomify/native` (5× higher throughput).
