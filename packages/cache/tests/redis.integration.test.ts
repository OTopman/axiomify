/**
 * @axiomify/cache — RedisCacheStore against a REAL Redis.
 *
 * Opt-in: skipped entirely unless `REDIS_URL` is set (see
 * test-helpers/mini-redis.ts and CONTRIBUTING.md for how to run these).
 * `packages/cache/tests/redis-store.test.ts` covers the same store against
 * an in-memory fake for both client styles — this file exists to catch
 * anything a fake can't: real TTL expiry, real NX semantics, real KEYS
 * pattern matching.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisCacheStore } from '../src/redis';
import type { CacheEntry } from '../src/store';
import { MiniRedis } from '../../../test-helpers/mini-redis';

const RUN = !!process.env.REDIS_URL;

function entry(over: Partial<CacheEntry> = {}): CacheEntry {
  return {
    payload: '{"ok":true}',
    statusCode: 200,
    contentType: 'application/json',
    etag: 'W/"x"',
    storedAt: Date.now(),
    ttlMs: 30_000,
    swrMs: 0,
    ...over,
  };
}

describe.skipIf(!RUN)('RedisCacheStore (real Redis)', () => {
  // Unique per test run so concurrent CI shards / repeat local runs never
  // collide, and cleanup only ever touches OUR keys.
  const keyPrefix = `axiomify:cache:test:${process.pid}:${Date.now()}:`;
  let client: MiniRedis;
  let store: RedisCacheStore;

  beforeAll(async () => {
    client = await MiniRedis.connect();
    store = new RedisCacheStore(client as any, { keyPrefix });
  });

  afterAll(async () => {
    // Prefix-scoped cleanup — never FLUSHDB a shared instance.
    await store.deleteByPrefix('');
    await client.quit();
  });

  it('round-trips an entry with a real TTL', async () => {
    const e = entry({ payload: '{"n":1}' });
    await store.set('a', e, 5);
    const got = await store.get('a');
    expect(got).toEqual(e);

    const ttl = await client.ttl(keyPrefix + 'a');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5);
  });

  it('expires an entry after its TTL elapses', async () => {
    await store.set('expiring', entry(), 1);
    expect(await store.get('expiring')).toBeDefined();

    await new Promise((r) => setTimeout(r, 1_300));
    expect(await store.get('expiring')).toBeUndefined();
  }, 5_000);

  it('deletes a single key', async () => {
    await store.set('to-delete', entry(), 30);
    await store.delete('to-delete');
    expect(await store.get('to-delete')).toBeUndefined();
  });

  it('clear() removes every entry under this store\'s prefix only', async () => {
    await store.set('x', entry(), 30);
    await store.set('y', entry(), 30);

    // A key OUTSIDE this store's prefix must survive clear() — deliberately
    // does NOT start with keyPrefix, unlike the entries above.
    const sentinelKey = `axiomify:cache:sibling:${process.pid}:sentinel`;
    await client.set(sentinelKey, '1', 'EX', 30);

    await store.clear();
    expect(await store.get('x')).toBeUndefined();
    expect(await store.get('y')).toBeUndefined();
    expect(await client.get(sentinelKey)).toBe('1');
    await client.del(sentinelKey);
  });

  it('acquireRefreshLock is atomic (NX) — a second acquire fails while held', async () => {
    const first = await store.acquireRefreshLock('swr-key', 5);
    const second = await store.acquireRefreshLock('swr-key', 5);
    expect(first).toBe(true);
    expect(second).toBe(false);

    await store.releaseRefreshLock('swr-key');
    const third = await store.acquireRefreshLock('swr-key', 5);
    expect(third).toBe(true);
    await store.releaseRefreshLock('swr-key');
  });

  it('corrupted JSON at a key is treated as a miss, not a crash', async () => {
    await client.set(keyPrefix + 'corrupt', 'not-json{{{', 'EX', 30);
    expect(await store.get('corrupt')).toBeUndefined();
  });
});
