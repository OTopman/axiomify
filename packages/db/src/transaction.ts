import { detectClientKind } from './detect';

const isFn = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function';

/**
 * Run `fn` inside a transaction, using whatever transaction primitive the
 * client family provides. The transactional handle (`tx`) passed to `fn`
 * depends on the client:
 *
 * | Kind             | Strategy                                              | `tx` is                    |
 * | ---------------- | ----------------------------------------------------- | -------------------------- |
 * | `prisma`         | `client.$transaction(fn)`                             | Prisma interactive tx      |
 * | `drizzle`        | `client.transaction(fn)`                              | Drizzle tx instance        |
 * | `pg`             | dedicated client: `BEGIN` / `COMMIT` / `ROLLBACK`     | checked-out `pg` client    |
 * | `mysql2`         | `getConnection()` + `beginTransaction()`/`commit()`/`rollback()` | pooled connection |
 * | `better-sqlite3` | `client.transaction(fn)()` — **`fn` must be synchronous** | the client itself     |
 *
 * On throw the transaction is rolled back (and the pooled connection
 * released, where applicable) before the error is re-thrown. Unknown
 * clients produce a clear error — pass one of the supported families or
 * open the transaction with your driver's own API.
 */
export async function withTransaction<C, T>(
  client: C,
  fn: (tx: any) => T | Promise<T>,
): Promise<T> {
  if (client === null || client === undefined) {
    throw new TypeError('[@axiomify/db] withTransaction requires a client.');
  }
  if (typeof fn !== 'function') {
    throw new TypeError(
      '[@axiomify/db] withTransaction requires a callback function.',
    );
  }

  const kind = detectClientKind(client);
  const c = client as Record<string, any>;

  switch (kind) {
    case 'prisma':
      return c.$transaction((tx: unknown) => fn(tx));

    case 'drizzle': {
      if (!isFn(c.transaction)) {
        throw new Error(
          '[@axiomify/db] This Drizzle instance does not expose .transaction(). ' +
            'Use the transaction API of your underlying driver instead.',
        );
      }
      return c.transaction((tx: unknown) => fn(tx)) as Promise<T>;
    }

    case 'pg': {
      const dedicated = await c.connect();
      try {
        await dedicated.query('BEGIN');
        const result = await fn(dedicated);
        await dedicated.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await dedicated.query('ROLLBACK');
        } catch {
          // Connection is likely dead — the original error matters more.
        }
        throw err;
      } finally {
        dedicated.release?.();
      }
    }

    case 'mysql2': {
      // Pools hand out a dedicated connection; a bare connection (no
      // getConnection) can run the transaction on itself.
      const conn = (
        isFn(c.getConnection) ? await c.getConnection() : c
      ) as Record<string, any>;
      if (!isFn(conn.beginTransaction)) {
        throw new Error(
          '[@axiomify/db] This mysql2 client does not expose beginTransaction(). ' +
            'Pass a promise-mode pool or connection (mysql2/promise).',
        );
      }
      try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          // Connection is likely dead — the original error matters more.
        }
        throw err;
      } finally {
        if (conn !== c) conn.release?.();
      }
    }

    case 'better-sqlite3': {
      // better-sqlite3 transactions are synchronous by design; an async
      // callback would commit before its awaited work ran.
      let result!: T | Promise<T>;
      const txn = c.transaction(() => {
        result = fn(client);
        if (result instanceof Promise) {
          throw new Error(
            '[@axiomify/db] better-sqlite3 transactions are synchronous — ' +
              'the withTransaction callback must not return a Promise.',
          );
        }
      });
      txn();
      return result as T;
    }

    default:
      throw new Error(
        '[@axiomify/db] withTransaction does not know how to open a transaction ' +
          'on this client (detected kind: "unknown"). Supported: Prisma, Drizzle, ' +
          'pg.Pool, mysql2 (promise) and better-sqlite3 — otherwise use your ' +
          "driver's own transaction API.",
      );
  }
}
