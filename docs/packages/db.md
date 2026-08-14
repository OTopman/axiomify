# @axiomify/db

Client-agnostic database integration: register any client (Prisma, Drizzle, pg, mysql2, better-sqlite3 or your own) through DI, with duck-typed lifecycle defaults, health checks, graceful shutdown, transactions and a stable CLI manifest contract. Zero runtime dependencies on any driver.

## Install

```bash
npm install @axiomify/db
```

## Exports

| Export                                                | Kind                                                     | Description                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `createDatabaseModule`                                | `(options) => DatabaseHandle`                            | Build the module + handle (see below).                                                                                 |
| `detectClientKind`                                    | `(client) => ClientKind`                                 | Duck-typed classification: `'prisma' \| 'drizzle' \| 'pg' \| 'mysql2' \| 'better-sqlite3' \| 'unknown'`.               |
| `deriveBehavior`                                      | `(kind) => DerivedBehavior`                              | Per-kind default `connect`/`disconnect`/`healthCheck`.                                                                 |
| `dbHealthChecks`                                      | `(...handles) => Record<string, () => Promise<boolean>>` | Checks record for `app.healthCheck(path, checks)`.                                                                     |
| `dbShutdown`                                          | `(...handles) => () => Promise<void>`                    | Parallel-disconnect callback for `gracefulShutdown`.                                                                   |
| `withTransaction`                                     | `(client, fn) => Promise<T>`                             | Per-family transaction wrapper.                                                                                        |
| `withTimeout`                                         | `(promise, ms, label?) => Promise<T>`                    | Timeout racer (used by health checks; exported for reuse).                                                             |
| `HEALTH_CHECK_TIMEOUT_MS`                             | `3000`                                                   | Per-probe timeout.                                                                                                     |
| `defineDbConfig` / `loadDbConfig` / `DB_CONFIG_FILES` | —                                                        | CLI manifest helpers (schema v1).                                                                                      |
| Types                                                 | —                                                        | `DatabaseHandle`, `DatabaseModuleOptions`, `ClientKind`, `DerivedBehavior`, `DbConfig`, `DbCommand`, `LoadedDbConfig`. |

## `createDatabaseModule(options)`

| Option             | Type                                | Default      | Description                                                                                                                                    |
| ------------------ | ----------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`           | `() => C \| Promise<C>`             | — (required) | Client factory; may be async.                                                                                                                  |
| `name`             | `string`                            | `'db'`       | DI token and health-check key. Must be unique per app.                                                                                         |
| `connect`          | `(client) => unknown`               | derived      | Establish the connection.                                                                                                                      |
| `disconnect`       | `(client) => unknown`               | derived      | Tear it down.                                                                                                                                  |
| `healthCheck`      | `(client) => unknown`               | derived      | Liveness probe: throwing, resolving `false` or exceeding 3 s = unhealthy.                                                                      |
| `vaultScope`       | `string`                            | —            | Run the factory inside `context.vault.scope(vaultScope, …)` so `process.env` reads during client construction are authorized under that scope. |
| `registerShutdown` | `(cb: () => Promise<void>) => void` | —            | Self-wiring hook: called once at creation with the disconnect callback.                                                                        |

Returns a `DatabaseHandle`:

| Member          | Type               | Description                                                                                                                                  |
| --------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `module`        | `AppModule`        | Pass to `app.use()`. Module names are instance-unique so two handles sharing a DI token fail loudly in DI instead of being silently deduped. |
| `ready`         | `Promise<C>`       | Resolves once factory + connect finish; rejects on failure. **Await before `listen()`.**                                                     |
| `client`        | `C`                | The real client — throws until `ready` resolved.                                                                                             |
| `name`          | `string`           | The DI token / health-check key.                                                                                                             |
| `kind`          | `ClientKind`       | `'unknown'` until `ready` resolves.                                                                                                          |
| `isReady`       | `boolean`          | True once connected.                                                                                                                         |
| `disconnect()`  | `Promise<void>`    | Idempotent; waits for an in-flight boot to settle first.                                                                                     |
| `healthCheck()` | `Promise<boolean>` | Runs the probe with the 3 s timeout; never throws.                                                                                           |

## The sync-provide / async-ready pattern

`app.use(module)` calls `register()` synchronously and the DI container seals at bootstrap, but a client factory is typically async. The module therefore provides a **stable Proxy** under the `name` token during that synchronous call, and kicks off factory + connect in the background:

```ts
const db = createDatabaseModule({ client: async () => new PrismaClient() });
app.use(db.module); // DI token 'db' available immediately
await db.ready; // ← REQUIRED before adapter.listen()
new NativeAdapter(app, { port: 3000 }).listen();
```

Before `ready` resolves, any property access on the Proxy throws a clear "database not ready" error (`then` and well-known symbols return `undefined` so `await`/`console.log` don't crash). After `ready`, the Proxy forwards transparently — methods are bound to the real client so drivers using `#private` fields (PrismaClient) work. A failed boot marks `ready` rejected; the rejection is pre-handled so it never becomes an `unhandledRejection` when nobody awaited it.

## Client detection and derived behavior

| Kind             | Detected by                                                   | connect             | disconnect                                   | healthCheck                 |
| ---------------- | ------------------------------------------------------------- | ------------------- | -------------------------------------------- | --------------------------- |
| `prisma`         | `$connect` + `$disconnect`                                    | `$connect()`        | `$disconnect()`                              | `` $queryRaw`SELECT 1` ``   |
| `pg`             | `query` + `end` + `connect` (pg.Pool)                         | `query('SELECT 1')` | `end()`                                      | `query('SELECT 1')`         |
| `mysql2`         | `query` + `end`                                               | `query('SELECT 1')` | `end()`                                      | `query('SELECT 1')`         |
| `better-sqlite3` | `prepare` + `close`                                           | no-op               | `close()`                                    | `prepare('SELECT 1').get()` |
| `drizzle`        | `execute`, or `transaction`+`select`, or internal `_.session` | no-op               | best-effort `$client.end()`                  | `execute('SELECT 1')`       |
| `unknown`        | anything else                                                 | no-op               | best-effort `disconnect()`/`close()`/`end()` | always healthy              |

Detection order matters (mysql2 before drizzle, pg before mysql2) because the surfaces overlap. Explicit options always override derived behavior; pools get an eager `SELECT 1` on connect so bad credentials fail at boot, not on the first request.

## Health checks and shutdown

```ts
app.healthCheck('/health', dbHealthChecks(primary, analytics));
gracefulShutdown(server, { onShutdown: dbShutdown(primary, analytics) });
```

- `dbHealthChecks` keys the record by handle `name`; duplicates throw. Each check never throws — errors, timeouts (3 s) and not-ready resolve `false`.
- `dbShutdown` disconnects all handles in parallel; failures are aggregated into one `AggregateError` naming the failing databases, so the rest still close cleanly.

## `withTransaction(client, fn)`

| Kind             | Strategy                                                                              | `tx` passed to `fn`     |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------- |
| `prisma`         | `client.$transaction(fn)`                                                             | Prisma interactive tx   |
| `drizzle`        | `client.transaction(fn)`                                                              | Drizzle tx instance     |
| `pg`             | dedicated client: `BEGIN` / `COMMIT` / `ROLLBACK`, then released                      | checked-out `pg` client |
| `mysql2`         | `getConnection()` (or the bare connection) + `beginTransaction`/`commit`/`rollback`   | pooled connection       |
| `better-sqlite3` | `client.transaction(fn)()` — **`fn` must be synchronous**; returning a Promise throws | the client itself       |
| `unknown`        | throws — use your driver's own transaction API                                        | —                       |

On throw the transaction rolls back (rollback failures on a dead connection are swallowed in favor of the original error) and the error re-throws.

## CLI manifest (schema v1 — stable)

`axiomify db` commands discover the project workflow from `axiomify.db.json` (shell strings only) or `axiomify.db.mjs` (default export, functions allowed) at the project root:

```jsonc
{
  "version": 1,
  "commands": {
    "migrate": "prisma migrate deploy",
    "seed": "node ./scripts/seed.mjs",
    "generate": "prisma generate",
  },
}
```

- Allowed commands: `migrate`, `seed`, `generate` — each optional; unknown command names are rejected; unknown top-level keys are ignored (forward compatibility).
- `defineDbConfig(config)` — typed identity helper for `.mjs` manifests; validates eagerly.
- `loadDbConfig(cwd)` — looks for both filenames directly in `cwd` (no upward traversal). Resolves `null` when neither exists; throws when both exist, on malformed JSON / failed import, or on a schema violation. Resolves `{ path, format: 'json' | 'mjs', config }`.
