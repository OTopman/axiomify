import { describe, it, expect, vi } from 'vitest';
import { withTransaction } from '../src/transaction';
import {
  fakeBetterSqlite3,
  fakeDrizzle,
  fakeMysql2Connection,
  fakeMysql2Pool,
  fakePgPool,
  fakePrisma,
} from './fakes';

describe('withTransaction', () => {
  it('validates its arguments', async () => {
    await expect(withTransaction(null, () => 1)).rejects.toThrow(
      /requires a client/,
    );
    await expect(
      withTransaction(fakePrisma(), undefined as never),
    ).rejects.toThrow(/requires a callback/);
  });

  it('prisma: delegates to $transaction', async () => {
    const prisma = fakePrisma();
    const result = await withTransaction(prisma, async (tx) => {
      expect(tx).toEqual({ marker: 'prisma-tx' });
      return 'done';
    });
    expect(result).toBe('done');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('drizzle: delegates to client.transaction', async () => {
    const drizzle = fakeDrizzle();
    const result = await withTransaction(drizzle, async (tx) => {
      expect(tx).toEqual({ marker: 'drizzle-tx' });
      return 7;
    });
    expect(result).toBe(7);
    expect(drizzle.transaction).toHaveBeenCalledOnce();
  });

  it('pg: BEGIN/COMMIT on a dedicated client, then release', async () => {
    const { pool, dedicated } = fakePgPool();
    const result = await withTransaction(pool, async (tx) => {
      expect(tx).toBe(dedicated);
      await tx.query('INSERT INTO t VALUES (1)');
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(dedicated.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
    ]);
    expect(dedicated.release).toHaveBeenCalledOnce();
  });

  it('pg: ROLLBACK + release + rethrow when the callback throws', async () => {
    const { pool, dedicated } = fakePgPool();
    await expect(
      withTransaction(pool, async () => {
        throw new Error('constraint violation');
      }),
    ).rejects.toThrow('constraint violation');
    expect(dedicated.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(dedicated.release).toHaveBeenCalledOnce();
  });

  it('pg: preserves the original error when ROLLBACK also fails', async () => {
    const { pool, dedicated } = fakePgPool();
    dedicated.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    });
    await expect(
      withTransaction(pool, async () => {
        throw new Error('original failure');
      }),
    ).rejects.toThrow('original failure');
    expect(dedicated.release).toHaveBeenCalledOnce();
  });

  it('mysql2 pool: getConnection + begin/commit + release', async () => {
    const { pool, connection } = fakeMysql2Pool();
    const result = await withTransaction(pool, async (tx) => {
      expect(tx).toBe(connection);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('mysql2 pool: rollback + release + rethrow on failure', async () => {
    const { pool, connection } = fakeMysql2Pool();
    await expect(
      withTransaction(pool, async () => {
        throw new Error('deadlock');
      }),
    ).rejects.toThrow('deadlock');
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('mysql2 bare connection: transacts on itself without release', async () => {
    const conn = fakeMysql2Connection();
    await withTransaction(conn, async () => 'ok');
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it('mysql2: clear error when the client lacks beginTransaction', async () => {
    const callbackPool = {
      query: vi.fn(),
      end: vi.fn(),
      getConnection: vi.fn(async () => ({ release: vi.fn() })),
    };
    await expect(withTransaction(callbackPool, async () => 1)).rejects.toThrow(
      /does not expose beginTransaction/,
    );
  });

  it('better-sqlite3: runs a synchronous callback atomically', async () => {
    const { db } = fakeBetterSqlite3();
    const result = await withTransaction(db, (tx) => {
      expect(tx).toBe(db);
      return 42;
    });
    expect(result).toBe(42);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('better-sqlite3: rejects async callbacks (sync-only engine)', async () => {
    const { db } = fakeBetterSqlite3();
    await expect(
      withTransaction(db, async () => 'nope'),
    ).rejects.toThrow(/must not return a Promise/);
  });

  it('better-sqlite3: propagates callback errors (engine rolls back)', async () => {
    const { db } = fakeBetterSqlite3();
    await expect(
      withTransaction(db, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('drizzle detected via _.session without transaction(): clear error', async () => {
    await expect(
      withTransaction({ _: { session: {} } }, () => 1),
    ).rejects.toThrow(/does not expose \.transaction\(\)/);
  });

  it('unknown client: clear unsupported error', async () => {
    await expect(withTransaction({ foo: 1 }, () => 1)).rejects.toThrow(
      /detected kind: "unknown"/,
    );
  });
});
