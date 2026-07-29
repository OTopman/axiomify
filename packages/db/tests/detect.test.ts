import { describe, it, expect, vi } from 'vitest';
import { detectClientKind, deriveBehavior } from '../src/detect';
import {
  fakeBetterSqlite3,
  fakeDrizzle,
  fakeDrizzleSqlite,
  fakeMysql2Connection,
  fakeMysql2Pool,
  fakePgPool,
  fakePrisma,
} from './fakes';

describe('detectClientKind', () => {
  it('detects a Prisma client by $connect/$disconnect', () => {
    expect(detectClientKind(fakePrisma())).toBe('prisma');
  });

  it('detects a pg.Pool by query/end/connect', () => {
    expect(detectClientKind(fakePgPool().pool)).toBe('pg');
  });

  it('detects a mysql2 pool by query/end (getConnection, no connect)', () => {
    expect(detectClientKind(fakeMysql2Pool().pool)).toBe('mysql2');
  });

  it('detects a bare mysql2 connection', () => {
    expect(detectClientKind(fakeMysql2Connection())).toBe('mysql2');
  });

  it('prefers mysql2 over drizzle even when .execute exists (overlap)', () => {
    const { pool } = fakeMysql2Pool();
    expect(typeof pool.execute).toBe('function');
    expect(detectClientKind(pool)).toBe('mysql2');
  });

  it('detects better-sqlite3 by prepare/close', () => {
    expect(detectClientKind(fakeBetterSqlite3().db)).toBe('better-sqlite3');
  });

  it('detects drizzle by execute()', () => {
    expect(detectClientKind(fakeDrizzle())).toBe('drizzle');
  });

  it('detects sqlite-dialect drizzle by transaction()+select()', () => {
    expect(detectClientKind(fakeDrizzleSqlite())).toBe('drizzle');
  });

  it('detects drizzle by internal _.session marker', () => {
    expect(detectClientKind({ _: { session: {} } })).toBe('drizzle');
  });

  it('returns unknown for primitives, null and plain objects', () => {
    expect(detectClientKind(null)).toBe('unknown');
    expect(detectClientKind(undefined)).toBe('unknown');
    expect(detectClientKind(42)).toBe('unknown');
    expect(detectClientKind('db')).toBe('unknown');
    expect(detectClientKind({})).toBe('unknown');
    expect(detectClientKind({ _: null })).toBe('unknown');
  });
});

describe('deriveBehavior', () => {
  it('prisma: $connect / $disconnect / $queryRaw probe', async () => {
    const client = fakePrisma();
    const behavior = deriveBehavior('prisma');
    await behavior.connect(client);
    await behavior.disconnect(client);
    await behavior.healthCheck(client);
    expect(client.$connect).toHaveBeenCalledOnce();
    expect(client.$disconnect).toHaveBeenCalledOnce();
    expect(client.$queryRaw).toHaveBeenCalledOnce();
  });

  it('prisma: health probe degrades to true without $queryRaw', () => {
    const behavior = deriveBehavior('prisma');
    expect(behavior.healthCheck({ $connect() {}, $disconnect() {} })).toBe(
      true,
    );
  });

  it('pg/mysql2: eager SELECT 1 on connect, end() on disconnect', async () => {
    for (const kind of ['pg', 'mysql2'] as const) {
      const client = {
        query: vi.fn(async () => ({})),
        end: vi.fn(async () => undefined),
      };
      const behavior = deriveBehavior(kind);
      await behavior.connect(client);
      await behavior.healthCheck(client);
      expect(client.query).toHaveBeenCalledTimes(2);
      expect(client.query).toHaveBeenCalledWith('SELECT 1');
      await behavior.disconnect(client);
      expect(client.end).toHaveBeenCalledOnce();
    }
  });

  it('better-sqlite3: no-op connect, close(), prepared SELECT 1 probe', async () => {
    const { db, statement } = fakeBetterSqlite3();
    const behavior = deriveBehavior('better-sqlite3');
    await behavior.connect(db);
    expect(db.prepare).not.toHaveBeenCalled();
    await behavior.healthCheck(db);
    expect(db.prepare).toHaveBeenCalledWith('SELECT 1');
    expect(statement.get).toHaveBeenCalledOnce();
    await behavior.disconnect(db);
    expect(db.close).toHaveBeenCalledOnce();
  });

  it('drizzle: no-op connect, best-effort $client.end(), execute probe', async () => {
    const client = fakeDrizzle();
    const behavior = deriveBehavior('drizzle');
    await behavior.connect(client);
    await behavior.healthCheck(client);
    expect(client.execute).toHaveBeenCalledWith('SELECT 1');
    await behavior.disconnect(client);
    expect(client.$client.end).toHaveBeenCalledOnce();
  });

  it('drizzle: tolerates missing execute and missing $client', async () => {
    const behavior = deriveBehavior('drizzle');
    expect(behavior.healthCheck({})).toBe(true);
    await expect(
      Promise.resolve(behavior.disconnect({})),
    ).resolves.toBeUndefined();
  });

  it('unknown: no-op connect, always-healthy probe, best-effort teardown', async () => {
    const behavior = deriveBehavior('unknown');
    expect(behavior.connect({})).toBeUndefined();
    expect(behavior.healthCheck({})).toBe(true);

    const viaDisconnect = { disconnect: vi.fn() };
    const viaClose = { close: vi.fn() };
    const viaEnd = { end: vi.fn() };
    behavior.disconnect(viaDisconnect);
    behavior.disconnect(viaClose);
    behavior.disconnect(viaEnd);
    expect(viaDisconnect.disconnect).toHaveBeenCalledOnce();
    expect(viaClose.close).toHaveBeenCalledOnce();
    expect(viaEnd.end).toHaveBeenCalledOnce();
    expect(behavior.disconnect({})).toBeUndefined();
  });
});
