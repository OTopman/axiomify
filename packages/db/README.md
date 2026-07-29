# @axiomify/db

[![npm version](https://img.shields.io/npm/v/@axiomify/db.svg)](https://npmjs.com/package/@axiomify/db)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Client-agnostic database integration for Axiomify — register any client (Prisma, Drizzle, pg, mysql2, better-sqlite3 or your own) through DI, with duck-typed lifecycle defaults, health checks, graceful shutdown, transactions and a stable CLI manifest contract. Zero runtime dependencies on any driver.

## Install

```bash
npm install @axiomify/db
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { createDatabaseModule } from '@axiomify/db';
import { PrismaClient } from '@prisma/client';

const app = new Axiomify();
const db = createDatabaseModule({ client: async () => new PrismaClient() });

app.use(db.module);   // DI token 'db' is available immediately
await db.ready;       // ⚠️ REQUIRED before listen() — see below
new NativeAdapter(app, { port: 3000 }).listen();
```

The client is provided in DI under the module's `name` (default `'db'`); the handle also exposes it directly:

```typescript
const client = app.resolve('db'); // the same Proxy handlers and modules see

app.route({
  method: 'GET',
  path: '/users',
  handler: async (_req, res) => res.send(await client.user.findMany()),
});
```

## `await db.ready` — why it is required

`app.use()` invokes a module's `register()` **synchronously**, and the DI container seals at bootstrap — but a client factory is typically async. `createDatabaseModule` therefore provides a **stable Proxy** into DI synchronously; the factory + connect step run in the background and are surfaced through `db.ready`. Once `ready` resolves, the Proxy forwards transparently to the real client. Before that, **any property access throws** a clear "database not ready" error.

Always `await db.ready` before `listen()` (and before any startup code touches the client). If boot fails, `ready` rejects with the underlying error.

## Supported client families

`detectClientKind(client)` classifies a client by duck-typing its public surface — no `instanceof`, no driver dependency:

| Kind             | Detected by                                              | connect default        | disconnect default        | health default              |
| ---------------- | -------------------------------------------------------- | ---------------------- | ------------------------- | --------------------------- |
| `prisma`         | `$connect()` + `$disconnect()`                           | `$connect()`           | `$disconnect()`           | `` $queryRaw`SELECT 1` ``   |
| `pg`             | `query()` + `end()` + `connect()` (pg.Pool)              | `query('SELECT 1')`    | `end()`                   | `query('SELECT 1')`         |
| `mysql2`         | `query()` + `end()`                                      | `query('SELECT 1')`    | `end()`                   | `query('SELECT 1')`         |
| `better-sqlite3` | `prepare()` + `close()`                                  | no-op                  | `close()`                 | `prepare('SELECT 1').get()` |
| `drizzle`        | `execute()`, or `transaction()`+`select()`, or `_.session` | no-op                | best-effort `$client.end()` | `execute('SELECT 1')`     |
| `unknown`        | anything else                                            | no-op                  | best-effort `disconnect()`/`close()`/`end()` | always healthy — pass your own |

Explicit `connect` / `disconnect` / `healthCheck` options always override the derived defaults. Pools connect lazily, so pg/mysql2 get an eager `SELECT 1` at boot — bad credentials fail before `listen()`, not on the first request.

## Health checks

```typescript
import { dbHealthChecks } from '@axiomify/db';

app.healthCheck('/health', dbHealthChecks(primary, analytics));
// → { primary: () => Promise<boolean>, analytics: () => Promise<boolean> }
```

Each probe runs with a 3 s timeout (`HEALTH_CHECK_TIMEOUT_MS`) and never throws — errors, timeouts and not-ready all resolve `false`. Duplicate `name`s throw immediately.

## Transactions

```typescript
import { withTransaction } from '@axiomify/db';

await withTransaction(db.client, async (tx) => {
  await tx.user.create({ data });
  await tx.audit.create({ data: log });
});
```

| Kind             | Strategy                                                          | `tx` is                 |
| ---------------- | ----------------------------------------------------------------- | ----------------------- |
| `prisma`         | `client.$transaction(fn)`                                         | Prisma interactive tx   |
| `drizzle`        | `client.transaction(fn)`                                          | Drizzle tx instance     |
| `pg`             | dedicated client: `BEGIN` / `COMMIT` / `ROLLBACK`                 | checked-out `pg` client |
| `mysql2`         | `getConnection()` + `beginTransaction()`/`commit()`/`rollback()`  | pooled connection       |
| `better-sqlite3` | `client.transaction(fn)()` — **the callback must be synchronous** | the client itself       |

On throw the transaction is rolled back (and the pooled connection released) before the error re-throws. A better-sqlite3 callback that returns a Promise throws — its transactions are synchronous by design. Unknown clients produce a clear error.

## Graceful shutdown

```typescript
import { dbShutdown } from '@axiomify/db';

gracefulShutdown(server, { onShutdown: dbShutdown(primary, analytics) });
```

All disconnects run in parallel; failures are collected into one `AggregateError` so the remaining databases still close. Alternatively, let each database self-wire via `createDatabaseModule({ registerShutdown: (cb) => shutdownCallbacks.push(cb) })`. `db.disconnect()` is idempotent and waits for an in-flight boot to settle first.

## CLI manifest (`axiomify db`)

The Axiomify CLI discovers your migration workflow through a manifest at the project root — `axiomify.db.json` (shell strings only) or `axiomify.db.mjs` (functions allowed, default export):

```js
// axiomify.db.mjs
import { defineDbConfig } from '@axiomify/db';

export default defineDbConfig({
  version: 1,
  commands: {
    migrate: 'prisma migrate deploy',
    seed: 'node ./scripts/seed.mjs',
    generate: 'prisma generate',
  },
});
```

Schema v1 is stable: `migrate` / `seed` / `generate` are the allowed commands, unknown command names are rejected, unknown top-level keys are ignored (forward compatibility). `loadDbConfig(cwd)` locates, loads and validates the manifest (`null` when absent; both files present is an error).
