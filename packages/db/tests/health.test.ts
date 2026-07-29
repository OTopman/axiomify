import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { createDatabaseModule } from '../src/module';
import { dbHealthChecks, dbShutdown } from '../src/health';
import type { DatabaseHandle } from '../src/module';
import { fakePgPool, fakePrisma } from './fakes';

async function readyDb(name: string, client: unknown, probe?: () => unknown) {
  const db = createDatabaseModule({
    name,
    client: () => client,
    ...(probe ? { healthCheck: probe } : {}),
  });
  new Axiomify().use(db.module);
  await db.ready;
  return db;
}

describe('dbHealthChecks', () => {
  it('maps each handle name to a boolean-returning check', async () => {
    const db1 = await readyDb('primary', fakePrisma());
    const db2 = await readyDb('analytics', fakePgPool().pool, () => {
      throw new Error('down');
    });

    const checks = dbHealthChecks(db1, db2);
    expect(Object.keys(checks)).toEqual(['primary', 'analytics']);
    await expect(checks.primary()).resolves.toBe(true);
    await expect(checks.analytics()).resolves.toBe(false);
  });

  it('is compatible with app.healthCheck()', async () => {
    const db = await readyDb('main', fakePrisma());
    const app = new Axiomify();
    expect(() => app.healthCheck('/health', dbHealthChecks(db))).not.toThrow();
  });

  it('rejects duplicate names and empty input', async () => {
    const db = await readyDb('dupname', fakePrisma());
    expect(() => dbHealthChecks(db, db)).toThrow(/Duplicate database name/);
    expect(() => dbHealthChecks()).toThrow(/at least one database handle/);
  });
});

describe('dbShutdown', () => {
  it('disconnects every handle', async () => {
    const prisma = fakePrisma();
    const { pool } = fakePgPool();
    const db1 = await readyDb('sd1', prisma);
    const db2 = await readyDb('sd2', pool);

    await dbShutdown(db1, db2)();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('still disconnects the rest and aggregates failures', async () => {
    const prisma = fakePrisma();
    const healthy = await readyDb('sd-ok', prisma);
    const broken: DatabaseHandle = {
      name: 'sd-broken',
      module: { name: 'x', register: vi.fn() },
      ready: Promise.resolve(null),
      client: null,
      kind: 'unknown',
      isReady: true,
      disconnect: vi.fn(async () => {
        throw new Error('socket already closed');
      }),
      healthCheck: async () => true,
    };

    const onShutdown = dbShutdown(broken, healthy);
    await expect(onShutdown()).rejects.toThrow(
      /Failed to disconnect 1 database\(s\): "sd-broken"/,
    );
    expect(prisma.$disconnect).toHaveBeenCalledOnce();

    // The aggregate carries the underlying errors.
    const err = await onShutdown().catch((e: AggregateError) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.errors[0].message).toBe('socket already closed');
  });

  it('wraps non-Error rejection reasons', async () => {
    const broken = {
      name: 'weird',
      disconnect: async () => Promise.reject('plain string'),
    } as unknown as DatabaseHandle;
    const err = await dbShutdown(broken)().catch((e: AggregateError) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect(err.errors[0]).toBeInstanceOf(Error);
    expect(err.errors[0].message).toBe('plain string');
  });

  it('rejects empty input', () => {
    expect(() => dbShutdown()).toThrow(/at least one database handle/);
  });
});
