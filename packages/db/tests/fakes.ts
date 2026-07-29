/**
 * Fake database clients matching the duck-typed surfaces of each supported
 * family. Shared by the detection, module, health and transaction tests.
 */
import { vi } from 'vitest';

export function fakePrisma() {
  return {
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $queryRaw: vi.fn(async () => [{ ok: 1 }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ marker: 'prisma-tx' }),
    ),
    user: { findMany: vi.fn(async () => []) },
  };
}

export function fakePgPool() {
  const dedicated = {
    query: vi.fn(async (_sql: string) => ({ rows: [] })),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (_sql: string) => ({ rows: [{ ok: 1 }] })),
    end: vi.fn(async () => undefined),
    connect: vi.fn(async () => dedicated),
  };
  return { pool, dedicated };
}

export function fakeMysql2Pool() {
  const connection = {
    query: vi.fn(async (_sql: string) => [[], []]),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async (_sql: string) => [[{ ok: 1 }], []]),
    execute: vi.fn(async (_sql: string) => [[{ ok: 1 }], []]),
    end: vi.fn(async () => undefined),
    getConnection: vi.fn(async () => connection),
  };
  return { pool, connection };
}

export function fakeMysql2Connection() {
  return {
    query: vi.fn(async (_sql: string) => [[{ ok: 1 }], []]),
    end: vi.fn(async () => undefined),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
}

export function fakeBetterSqlite3() {
  const statement = { get: vi.fn(() => 1) };
  const db = {
    prepare: vi.fn((_sql: string) => statement),
    close: vi.fn(),
    // Real better-sqlite3: transaction(fn) returns a callable that runs fn
    // atomically and rolls back if it throws.
    transaction: vi.fn(
      (fn: (...args: unknown[]) => unknown) =>
        (...args: unknown[]) =>
          fn(...args),
    ),
  };
  return { db, statement };
}

export function fakeDrizzle() {
  return {
    execute: vi.fn(async (_sql: string) => [{ ok: 1 }]),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ marker: 'drizzle-tx' }),
    ),
    select: vi.fn(),
    $client: { end: vi.fn(async () => undefined) },
  };
}

/** sqlite-dialect Drizzle: no `execute`, but `transaction` + query builder. */
export function fakeDrizzleSqlite() {
  return {
    transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({ marker: 'drizzle-sqlite-tx' }),
    ),
    select: vi.fn(),
    run: vi.fn(),
  };
}
