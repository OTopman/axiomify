# @axiomify/native


[![npm version](https://img.shields.io/npm/v/@axiomify/native.svg)](https://npmjs.com/package/@axiomify/native)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

uWebSockets.js adapter for Axiomify. Highest-throughput transport: 73,000–84,000 req/s single-process on an 8-core machine.

## Install

```bash
npm install @axiomify/native @axiomify/core zod
```

Requires Node.js ≥ 18, ≤ 20 (uWS pre-compiled binary).

## Quick example

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const app = new Axiomify();
app.enableRequestId();

app.route({
  method: 'GET',
  path: '/ping',
  handler: async (_req, res) => res.send({ pong: true }),
});

const adapter = new NativeAdapter(app, { port: 3000 });

// Single process
adapter.listen(() => console.log('Ready on :3000'));

// Multi-core (production)
adapter.listenClustered({
  onWorkerReady: () => console.log(`[${process.pid}] ready`),
  onPrimary:     (pids) => console.log('Workers:', pids),
  onWorkerExit:  (pid, code) => console.error(`Worker ${pid} exited (${code})`),
});
// Zero-downtime reload: kill -USR2 <primary-pid>
```

## Benchmarks

| Scenario | Req/s | p99 |
|---|---:|---:|
| GET /users/:id/posts/:postId | 83,947 | 20 ms |
| GET /ping | 73,511 | 26 ms |
| POST /echo (JSON body) | 54,720 | 30 ms |

*8-core machine, autocannon 100 conns, pipelining 10, 12 s.*

## Documentation

See [docs/packages/native.md](https://github.com/OTopman/axiomify/blob/main/docs/packages/native.md).
