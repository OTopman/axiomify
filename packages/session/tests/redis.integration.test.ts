/**
 * @axiomify/session — RedisSessionStore against a REAL Redis.
 *
 * Opt-in: skipped unless `REDIS_URL` is set (see test-helpers/mini-redis.ts
 * and CONTRIBUTING.md). `stores.test.ts` covers this store against an
 * in-memory fake for both client styles — this file exercises real TTL
 * expiry, real EXPIRE-based touch(), and prefix isolation between stores.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisSessionStore } from '../src/stores';
import type { SessionRecord } from '../src/stores';
import { MiniRedis } from '../../../test-helpers/mini-redis';

const RUN = !!process.env.REDIS_URL;

function record(over: Partial<SessionRecord['data']> = {}): SessionRecord {
  return { data: { userId: 1, ...over }, createdAt: Date.now() };
}

describe.skipIf(!RUN)('RedisSessionStore (real Redis)', () => {
  const prefix = `axiomify:sess:test:${process.pid}:${Date.now()}:`;
  let client: MiniRedis;
  let store: RedisSessionStore;

  beforeAll(async () => {
    client = await MiniRedis.connect();
    store = new RedisSessionStore(client as any, { prefix });
  });

  afterAll(async () => {
    await client.quit();
  });

  it('round-trips a session record with a real TTL', async () => {
    const rec = record({ name: 'Ada' });
    await store.set('sid-1', rec, 60);

    expect(await store.get('sid-1')).toEqual(rec);
    const ttl = await client.ttl(prefix + 'sid-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('destroy() deletes the record', async () => {
    await store.set('sid-2', record(), 60);
    await store.destroy('sid-2');
    expect(await store.get('sid-2')).toBeNull();
  });

  it('touch() extends the TTL via EXPIRE without rewriting data', async () => {
    await store.set('sid-3', record({ n: 1 }), 2);
    await store.touch('sid-3', 60);

    const ttl = await client.ttl(prefix + 'sid-3');
    expect(ttl).toBeGreaterThan(2); // extended well past the original 2s
    expect(await store.get('sid-3')).toEqual(record({ n: 1 }));
  });

  it('expires a session after its TTL elapses', async () => {
    await store.set('sid-expiring', record(), 1);
    expect(await store.get('sid-expiring')).not.toBeNull();

    await new Promise((r) => setTimeout(r, 1_300));
    expect(await store.get('sid-expiring')).toBeNull();
  }, 5_000);

  it('two stores with different prefixes never see each other\'s sessions', async () => {
    const otherPrefix = `axiomify:sess:other:${process.pid}:${Date.now()}:`;
    const other = new RedisSessionStore(client as any, { prefix: otherPrefix });

    await store.set('shared-id', record({ tenant: 'a' }), 30);
    await other.set('shared-id', record({ tenant: 'b' }), 30);

    expect(await store.get('shared-id')).toEqual(record({ tenant: 'a' }));
    expect(await other.get('shared-id')).toEqual(record({ tenant: 'b' }));

    await store.destroy('shared-id');
    await other.destroy('shared-id');
  });

  it('a corrupted record is treated as a missing session, not a crash', async () => {
    await client.set(prefix + 'sid-corrupt', 'not-json{{{', 'EX', 30);
    expect(await store.get('sid-corrupt')).toBeNull();
  });
});
