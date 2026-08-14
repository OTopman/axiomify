import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySessionStore, RedisSessionStore } from '../src/index';
import type { SessionRecord } from '../src/index';

function record(data: Record<string, unknown> = {}): SessionRecord {
  return { data, createdAt: Date.now() };
}

describe('MemorySessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('round-trips a record', async () => {
    const store = new MemorySessionStore();
    await store.set('a', record({ userId: 42 }), 60);
    const got = await store.get('a');
    expect(got?.data).toEqual({ userId: 42 });
    store.close();
  });

  it('returns null for a missing id', async () => {
    const store = new MemorySessionStore();
    expect(await store.get('nope')).toBeNull();
    store.close();
  });

  it('clones on read and write — callers never alias live store state', async () => {
    const store = new MemorySessionStore();
    const rec = record({ user: { name: 'ada' } });
    await store.set('a', rec, 60);

    // Mutating the record we passed in must not affect the stored copy.
    (rec.data.user as Record<string, unknown>).name = 'mutated-in';
    const first = await store.get('a');
    expect((first!.data.user as Record<string, unknown>).name).toBe('ada');

    // Mutating what get() returned must not affect the stored copy either.
    (first!.data.user as Record<string, unknown>).name = 'mutated-out';
    const second = await store.get('a');
    expect((second!.data.user as Record<string, unknown>).name).toBe('ada');
    store.close();
  });

  it('expires entries lazily on get()', async () => {
    const store = new MemorySessionStore();
    await store.set('a', record({ x: 1 }), 10);
    vi.advanceTimersByTime(9_999);
    expect(await store.get('a')).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(await store.get('a')).toBeNull();
    expect(store.size).toBe(0); // lazy expiry also deletes
    store.close();
  });

  it('sweeps expired entries in the background without a get()', async () => {
    const store = new MemorySessionStore({ sweepIntervalMs: 1_000 });
    await store.set('a', record(), 1);
    await store.set('b', record(), 3_600);
    expect(store.size).toBe(2);
    vi.advanceTimersByTime(2_000); // sweep runs after 'a' expired
    expect(store.size).toBe(1);
    expect(await store.get('b')).not.toBeNull();
    store.close();
  });

  it('touch() extends the TTL without rewriting data', async () => {
    const store = new MemorySessionStore();
    await store.set('a', record({ x: 1 }), 10);
    vi.advanceTimersByTime(8_000);
    await store.touch('a', 10);
    vi.advanceTimersByTime(8_000); // 16s since set — would have expired
    expect((await store.get('a'))?.data).toEqual({ x: 1 });
    store.close();
  });

  it('touch() on a missing id is a no-op', async () => {
    const store = new MemorySessionStore();
    await expect(store.touch('nope', 10)).resolves.toBeUndefined();
    store.close();
  });

  it('destroy() removes the entry; destroying a missing id is a no-op', async () => {
    const store = new MemorySessionStore();
    await store.set('a', record(), 60);
    await store.destroy('a');
    expect(await store.get('a')).toBeNull();
    await expect(store.destroy('a')).resolves.toBeUndefined();
    store.close();
  });

  it('evicts oldest-written sessions past maxSessions (expired swept first)', async () => {
    const store = new MemorySessionStore({ maxSessions: 3 });
    await store.set('expired', record(), 1);
    vi.advanceTimersByTime(2_000);
    await store.set('a', record({ n: 1 }), 60);
    await store.set('b', record({ n: 2 }), 60);
    await store.set('c', record({ n: 3 }), 60); // over cap → sweep removes 'expired'
    expect(store.size).toBe(3);
    expect(await store.get('a')).not.toBeNull();

    await store.set('d', record({ n: 4 }), 60); // nothing expired → evict oldest ('a')
    expect(store.size).toBe(3);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('d')).not.toBeNull();
    store.close();
  });

  it('re-setting an id refreshes its eviction position', async () => {
    const store = new MemorySessionStore({ maxSessions: 2 });
    await store.set('a', record({ v: 1 }), 60);
    await store.set('b', record(), 60);
    await store.set('a', record({ v: 2 }), 60); // rewrite → 'a' becomes newest
    await store.set('c', record(), 60); // evicts 'b', not 'a'
    expect(await store.get('b')).toBeNull();
    expect((await store.get('a'))?.data).toEqual({ v: 2 });
    store.close();
  });

  it('close() stops the sweep timer', async () => {
    const store = new MemorySessionStore({ sweepIntervalMs: 1_000 });
    await store.set('a', record(), 1);
    store.close();
    vi.advanceTimersByTime(10_000);
    expect(store.size).toBe(1); // no sweep ran; entry still counted (expired but unswept)
  });
});

// ─── Redis fakes ─────────────────────────────────────────────────────────────

/** ioredis-style fake: `set(key, value, 'EX', ttl)` (variadic). */
function makeIoredisFake() {
  const data = new Map<string, string>();
  const calls: unknown[][] = [];
  return {
    data,
    calls,
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]) {
      calls.push(['set', key, value, ...args]);
      data.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      data.delete(key);
      return 1;
    },
    async expire(key: string, ttl: number) {
      calls.push(['expire', key, ttl]);
      return 1;
    },
  };
}

/** node-redis v4-style fake: `set(key, value, { EX: ttl })` — throws on variadic. */
function makeNodeRedisFake() {
  const data = new Map<string, string>();
  const calls: unknown[][] = [];
  let variadicRejections = 0;
  return {
    data,
    calls,
    get variadicRejections() {
      return variadicRejections;
    },
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]) {
      if (typeof args[0] === 'string') {
        variadicRejections++;
        throw new TypeError('Invalid argument type');
      }
      calls.push(['set', key, value, args[0]]);
      data.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      data.delete(key);
      return 1;
    },
    async expire(key: string, ttl: number) {
      calls.push(['expire', key, ttl]);
      return true;
    },
  };
}

/**
 * ioredis-style fake that ALSO exposes the `setex` marker method — real
 * ioredis clients always do. RedisSessionStore should detect this at
 * construction time and skip the probe entirely, even on the first call.
 */
function makeIoredisFakeWithMarker() {
  const base = makeIoredisFake();
  return {
    ...base,
    async setex(key: string, seconds: number, value: string) {
      return base.set(key, value, 'EX', seconds);
    },
  };
}

/**
 * node-redis v4-style fake that ALSO exposes the `setEx` marker method —
 * real redis@4 clients always do. Throws on ANY variadic set() call (not
 * just the first) so a leftover probe attempt fails the test loudly.
 */
function makeNodeRedisFakeWithMarker() {
  const data = new Map<string, string>();
  const calls: unknown[][] = [];
  let variadicAttempts = 0;
  return {
    data,
    calls,
    get variadicAttempts() {
      return variadicAttempts;
    },
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]) {
      if (typeof args[0] === 'string') {
        variadicAttempts++;
        throw new TypeError('Invalid argument type');
      }
      calls.push(['set', key, value, args[0]]);
      data.set(key, value);
      return 'OK';
    },
    async setEx(key: string, seconds: number, value: string) {
      calls.push(['setEx', key, seconds, value]);
      data.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      data.delete(key);
      return 1;
    },
    async expire(key: string, ttl: number) {
      calls.push(['expire', key, ttl]);
      return true;
    },
  };
}

describe('RedisSessionStore', () => {
  it('rejects clients missing required methods', () => {
    expect(() => new RedisSessionStore(null as never)).toThrow(
      /get\/set\/del\/expire/,
    );
    expect(
      () => new RedisSessionStore({ get: async () => null } as never),
    ).toThrow(/get\/set\/del\/expire/);
  });

  it('works with an ioredis-style client (variadic SET ... EX)', async () => {
    const client = makeIoredisFake();
    const store = new RedisSessionStore(client);
    await store.set('sid1', record({ userId: 7 }), 120);
    expect(client.calls[0]).toEqual([
      'set',
      'axiomify:sess:sid1',
      expect.stringContaining('"userId":7'),
      'EX',
      120,
    ]);
    const got = await store.get('sid1');
    expect(got?.data).toEqual({ userId: 7 });
  });

  it('caches the variadic style after the first probe', async () => {
    const client = makeIoredisFake();
    const setSpy = vi.spyOn(client, 'set');
    const store = new RedisSessionStore(client);
    await store.set('a', record(), 60);
    await store.set('b', record(), 60);
    // Both calls used the variadic shape directly (no fallback attempts).
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy.mock.calls.every((c) => c[2] === 'EX')).toBe(true);
  });

  it('works with a node-redis v4-style client (options-object SET)', async () => {
    const client = makeNodeRedisFake();
    const store = new RedisSessionStore(client);
    await store.set('sid2', record({ role: 'admin' }), 90);
    expect(client.calls[0]).toEqual([
      'set',
      'axiomify:sess:sid2',
      expect.any(String),
      { EX: 90 },
    ]);
    expect((await store.get('sid2'))?.data).toEqual({ role: 'admin' });
  });

  it('probes the argument shape only once for node-redis clients', async () => {
    const client = makeNodeRedisFake();
    const store = new RedisSessionStore(client);
    await store.set('a', record(), 60);
    await store.set('b', record(), 60);
    await store.set('c', record(), 60);
    expect(client.variadicRejections).toBe(1); // only the first call probed
  });

  it('detects the ioredis dialect via the setex marker — no probe on the first call', async () => {
    // Regression: RedisSessionStore used to have no marker check at all,
    // unlike RedisCacheStore — it always attempted the variadic form first
    // (which happens to succeed immediately for ioredis regardless), so
    // this specific case behaved correctly by coincidence. The node-redis
    // case below is the one that actually proves the fix.
    const client = makeIoredisFakeWithMarker();
    const setSpy = vi.spyOn(client, 'set');
    const store = new RedisSessionStore(client);
    await store.set('sid1', record({ userId: 7 }), 120);
    expect(setSpy).toHaveBeenCalledWith(
      'axiomify:sess:sid1',
      expect.stringContaining('"userId":7'),
      'EX',
      120,
    );
    expect((await store.get('sid1'))?.data).toEqual({ userId: 7 });
  });

  it('detects the redis@4 dialect via the setEx marker — never attempts the variadic form', async () => {
    // Regression: without a marker check, RedisSessionStore always tried
    // the variadic form FIRST for every client, forcing exactly one failed
    // round-trip on the first write for any marker-less redis@4 client
    // (proven by the "probes... only once" test above). A client that
    // exposes setEx should skip that probe entirely — detected at
    // construction time — the same way RedisCacheStore already does. The
    // `setEx` method itself is only a detection marker; the write still
    // goes through `.set(key, value, { EX })`, same as the marker-less
    // node-redis fake's own object-form call.
    const client = makeNodeRedisFakeWithMarker();
    const store = new RedisSessionStore(client);
    await store.set('sid2', record({ role: 'admin' }), 90);
    await store.set('sid3', record({ role: 'user' }), 90);
    expect(client.variadicAttempts).toBe(0);
    expect(client.calls[0]).toEqual([
      'set',
      'axiomify:sess:sid2',
      expect.stringContaining('"role":"admin"'),
      { EX: 90 },
    ]);
    expect((await store.get('sid2'))?.data).toEqual({ role: 'admin' });
  });

  it('applies a custom key prefix', async () => {
    const client = makeIoredisFake();
    const store = new RedisSessionStore(client, { prefix: 'myapp:s:' });
    await store.set('abc', record(), 60);
    expect(client.data.has('myapp:s:abc')).toBe(true);
    await store.destroy('abc');
    expect(client.data.has('myapp:s:abc')).toBe(false);
  });

  it('touch() maps to EXPIRE with a floor of 1 second', async () => {
    const client = makeIoredisFake();
    const store = new RedisSessionStore(client);
    await store.touch('sid', 0.2);
    expect(client.calls).toContainEqual(['expire', 'axiomify:sess:sid', 1]);
    await store.touch('sid', 10.4);
    expect(client.calls).toContainEqual(['expire', 'axiomify:sess:sid', 11]);
  });

  it('set() floors the TTL at 1 second', async () => {
    const client = makeIoredisFake();
    const store = new RedisSessionStore(client);
    await store.set('sid', record(), 0.01);
    expect(client.calls[0]![4]).toBe(1);
  });

  it('returns null for missing keys and corrupt JSON payloads', async () => {
    const client = makeIoredisFake();
    const store = new RedisSessionStore(client);
    expect(await store.get('missing')).toBeNull();
    client.data.set('axiomify:sess:bad', '{not json');
    expect(await store.get('bad')).toBeNull();
  });

  it('destroy() deletes the key', async () => {
    const client = makeIoredisFake();
    const store = new RedisSessionStore(client);
    await store.set('gone', record({ a: 1 }), 60);
    await store.destroy('gone');
    expect(await store.get('gone')).toBeNull();
  });
});
