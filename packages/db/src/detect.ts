/**
 * Duck-typed database client detection.
 *
 * @axiomify/db is client-agnostic and has zero runtime dependencies on any
 * driver or ORM. Instead of `instanceof` checks (which would require the
 * packages to be installed), clients are classified by their public surface.
 *
 * Detection order matters — some surfaces overlap:
 *  - `mysql2` pools expose `.execute` (prepared statements), which would
 *    otherwise look like a Drizzle instance, so the mysql2 check runs first.
 *  - `pg.Pool` exposes `.connect` in addition to `query`/`end`, which
 *    distinguishes it from a mysql2 pool (which exposes `.getConnection`).
 */

/** The client families @axiomify/db knows how to drive out of the box. */
export type ClientKind =
  | 'prisma'
  | 'drizzle'
  | 'pg'
  | 'mysql2'
  | 'better-sqlite3'
  | 'unknown';

const isFn = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function';

/**
 * Classify a database client by duck-typing its public API.
 *
 * | Kind             | Signature                                             |
 * | ---------------- | ----------------------------------------------------- |
 * | `prisma`         | `$connect()` and `$disconnect()`                      |
 * | `pg`             | `query()`, `end()` and `connect()` (pg.Pool)          |
 * | `mysql2`         | `query()` and `end()` (promise pool or connection)    |
 * | `better-sqlite3` | `prepare()` and `close()`                             |
 * | `drizzle`        | `execute()`, `transaction()`+`select()`, or an internal `._.session` |
 * | `unknown`        | anything else                                         |
 */
export function detectClientKind(client: unknown): ClientKind {
  if (
    client === null ||
    (typeof client !== 'object' && typeof client !== 'function')
  ) {
    return 'unknown';
  }
  const c = client as Record<string, unknown>;

  if (isFn(c.$connect) && isFn(c.$disconnect)) return 'prisma';
  if (isFn(c.query) && isFn(c.end) && isFn(c.connect)) return 'pg';
  if (isFn(c.query) && isFn(c.end)) return 'mysql2';
  if (isFn(c.prepare) && isFn(c.close)) return 'better-sqlite3';
  if (
    isFn(c.execute) ||
    // sqlite-dialect Drizzle instances have no `execute`, but always expose
    // the query builder (`select`) alongside `transaction`.
    (isFn(c.transaction) && isFn(c.select)) ||
    (typeof c._ === 'object' &&
      c._ !== null &&
      (c._ as Record<string, unknown>).session !== undefined)
  ) {
    return 'drizzle';
  }
  return 'unknown';
}

/**
 * Lifecycle behavior derived from a client kind. Explicit
 * `connect`/`disconnect`/`healthCheck` options always win over these.
 */
export interface DerivedBehavior<C = any> {
  connect: (client: C) => unknown;
  disconnect: (client: C) => unknown;
  healthCheck: (client: C) => unknown;
}

const noop = () => undefined;

/**
 * Sensible per-kind defaults for connect / disconnect / health probing.
 *
 *  - `prisma`: `$connect` / `$disconnect` / `` $queryRaw`SELECT 1` ``
 *  - `pg` / `mysql2`: eager `query('SELECT 1')` on connect (pools connect
 *    lazily — probing at boot surfaces bad credentials before `listen()`),
 *    `end()` on disconnect, `query('SELECT 1')` for health.
 *  - `better-sqlite3`: no-op connect (the constructor already opened the
 *    file), `close()`, `prepare('SELECT 1').get()`.
 *  - `drizzle`: no-op connect, best-effort `$client.end()` on disconnect
 *    (pass an explicit `disconnect` to close your underlying driver),
 *    `execute('SELECT 1')` for health.
 *  - `unknown`: no-op connect, best-effort `disconnect()`/`close()`/`end()`,
 *    always-healthy probe (pass an explicit `healthCheck`).
 */
export function deriveBehavior(kind: ClientKind): DerivedBehavior {
  switch (kind) {
    case 'prisma':
      return {
        connect: (c) => c.$connect(),
        disconnect: (c) => c.$disconnect(),
        healthCheck: (c) =>
          isFn(c.$queryRaw) ? c.$queryRaw`SELECT 1` : true,
      };
    case 'pg':
    case 'mysql2':
      return {
        connect: (c) => c.query('SELECT 1'),
        disconnect: (c) => c.end(),
        healthCheck: (c) => c.query('SELECT 1'),
      };
    case 'better-sqlite3':
      return {
        connect: noop,
        disconnect: (c) => c.close(),
        healthCheck: (c) => c.prepare('SELECT 1').get(),
      };
    case 'drizzle':
      return {
        connect: noop,
        disconnect: (c) => c.$client?.end?.(),
        healthCheck: (c) => (isFn(c.execute) ? c.execute('SELECT 1') : true),
      };
    default:
      return {
        connect: noop,
        disconnect: (c) => {
          if (isFn(c?.disconnect)) return c.disconnect();
          if (isFn(c?.close)) return c.close();
          if (isFn(c?.end)) return c.end();
          return undefined;
        },
        healthCheck: () => true,
      };
  }
}
