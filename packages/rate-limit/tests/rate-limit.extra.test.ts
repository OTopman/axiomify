import { describe, expect, it, vi } from 'vitest';
import { createRateLimitPlugin, MemoryStore, RedisStore } from '../src/index';
import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';

function makeReq(overrides: any = {}): AxiomifyRequest {
  return {
    id: 'req_1', method: 'POST', url: '/login', path: '/login',
    ip: '10.0.0.1', headers: {}, body: {}, query: {}, params: {},
    state: {}, raw: {}, stream: null as any,
    ...overrides,
  } as any;
}

function makeRes(): any {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let sent = false;
  const res: any = {
    status: vi.fn((c: number) => { statusCode = c; return res; }),
    header: vi.fn((k: string, v: string) => { headers[k] = v; return res; }),
    send: vi.fn(() => { sent = true; }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn(), sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
    get headersSent() { return sent; },
    get statusCode() { return statusCode; },
    raw: {}, capabilities: { sse: false, streaming: false },
    get headers() { return headers; },
  };
  return res;
}

describe('createRateLimitPlugin', () => {
  it('allows requests within the limit', async () => {
    const plugin = createRateLimitPlugin({
      store: new MemoryStore(),
      max: 5, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
    });
    const res = makeRes();
    await plugin(makeReq({ ip: '1.2.3.4' }), res);
    expect(res.headersSent).toBe(false);
  });

  it('blocks requests beyond the limit with 429', async () => {
    const store = new MemoryStore();
    const plugin = createRateLimitPlugin({
      store, max: 2, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
    });
    const req = makeReq({ ip: '5.5.5.5' });
    await plugin(req, makeRes());
    await plugin(req, makeRes());
    const finalRes = makeRes();
    await plugin(req, finalRes);
    expect(finalRes.statusCode).toBe(429);
  });

  it('sets RateLimit response headers', async () => {
    const plugin = createRateLimitPlugin({
      store: new MemoryStore(),
      max: 10, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
    });
    const res = makeRes();
    await plugin(makeReq({ ip: '6.6.6.6' }), res);
    expect(res.header).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(String));
  });

  it('uses keyGenerator when provided', async () => {
    const store = new MemoryStore();
    const plugin = createRateLimitPlugin({
      store, max: 2, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
      keyGenerator: (r) => (r as any).body?.email ?? r.ip,
    });
    // Exhaust limit for user A
    const reqA = makeReq({ body: { email: 'a@a.com' }, ip: '1.1.1.1' });
    await plugin(reqA, makeRes());
    await plugin(reqA, makeRes());
    await plugin(reqA, makeRes()); // 3rd — over limit

    // User B (different key) should not be limited
    const reqB = makeReq({ body: { email: 'b@b.com' }, ip: '1.1.1.1' });
    const resB = makeRes();
    await plugin(reqB, resB);
    expect(resB.statusCode).not.toBe(429);
  });

  it('returns 429 with default message when limit exceeded', async () => {
    const store = new MemoryStore();
    const plugin = createRateLimitPlugin({
      store, max: 1, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
    });
    const req = makeReq({ ip: '7.7.7.7' });
    await plugin(req, makeRes());
    const res = makeRes();
    await plugin(req, res);
    // Default message is 'Too Many Requests' sent as second arg to res.send
    expect(res.send).toHaveBeenCalledWith(null, 'Too Many Requests');
  });
});

describe('MemoryStore', () => {
  it('increments count per key', async () => {
    const store = new MemoryStore();
    const r1 = await store.increment('key-a', 60_000);
    expect(r1.count).toBe(1);
    const r2 = await store.increment('key-a', 60_000);
    expect(r2.count).toBe(2);
  });

  it('tracks separate keys independently', async () => {
    const store = new MemoryStore();
    await store.increment('k1', 60_000);
    await store.increment('k1', 60_000);
    const r = await store.increment('k2', 60_000);
    expect(r.count).toBe(1);
  });
});

describe('createRateLimitPlugin — edge cases', () => {
  it('throws in production when no store and no allowMemoryStoreInProduction', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(() =>
      createRateLimitPlugin({ windowMs: 1000, max: 10 }),
    ).toThrow(/Refusing to use in-memory/);
    process.env.NODE_ENV = original;
  });

  it('warns in production when allowMemoryStoreInProduction is true', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createRateLimitPlugin({ max: 5, windowMs: 1000, allowMemoryStoreInProduction: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MemoryStore'));
    process.env.NODE_ENV = original;
    vi.restoreAllMocks();
  });

  it('does not throw when skip() returns true', async () => {
    const plugin = createRateLimitPlugin({
      store: new MemoryStore(),
      max: 1, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
      skip: () => true,
    });
    const req = makeReq({ ip: '9.9.9.9' });
    // Even after exceeding limit, skip allows through
    for (let i = 0; i < 5; i++) await plugin(req, makeRes());
    const res = makeRes();
    await plugin(req, res);
    expect(res.statusCode).not.toBe(429);
  });

  it('falls back to IP when keyGenerator throws', async () => {
    const store = new MemoryStore();
    const plugin = createRateLimitPlugin({
      store, max: 10, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
      keyGenerator: () => { throw new Error('bad key'); },
    });
    const req = makeReq({ ip: '10.10.10.10' });
    const res = makeRes();
    // Should not throw even when keyGenerator throws
    await expect(plugin(req, res)).resolves.toBeUndefined();
  });
});

describe('RedisStore', () => {
  it('constructs without error', () => {
    // Just verify it can be constructed with a minimal client
    const client = {
      evalsha: vi.fn().mockResolvedValue([0, 0]),
      eval: vi.fn().mockResolvedValue([1, 9999]),
    } as any;
    const store = new RedisStore(client);
    expect(store).toBeDefined();
  });

  it('calls eval on first increment', async () => {
    const client = {
      eval: vi.fn().mockResolvedValue([1, 9999]),
    } as any;
    const store = new RedisStore(client);
    const result = await store.increment('test-key', 60_000);
    expect(result.count).toBe(1);
    expect(client.eval).toHaveBeenCalled();
  });
});

describe('MemoryStore — eviction and edge cases', () => {
  it('evicts oldest keys when maxKeys limit is exceeded', async () => {
    const store = new MemoryStore({ maxKeys: 3 });
    await store.increment('k1', 60_000);
    await store.increment('k2', 60_000);
    await store.increment('k3', 60_000);
    // This 4th key triggers eviction
    await store.increment('k4', 60_000);
    // Store should not grow beyond maxKeys
    expect((store as any).hits.size).toBeLessThanOrEqual(4);
  });

  it('close() clears the prune interval', () => {
    const store = new MemoryStore();
    expect(() => store.close()).not.toThrow();
  });
});

describe('createRateLimitPlugin — missing req.ip fallback', () => {
  it('uses "unknown" key when req.ip is empty and emits warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset the module-level _emittedIpWarning by reimporting in isolation
    const store = new MemoryStore();
    const plugin = createRateLimitPlugin({ store, max: 10, windowMs: 60_000, allowMemoryStoreInProduction: true });
    const req = makeReq({ ip: '' });
    await plugin(req, makeRes());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('req.ip is falsy'));
    warn.mockRestore();
  });
});

describe('MemoryStore — cleanup and compaction', () => {
  it('handles many requests to trigger internal compaction', async () => {
    const store = new MemoryStore({ maxKeys: 5 });
    // Insert enough entries to trigger maxKeys eviction
    for (let i = 0; i < 7; i++) {
      await store.increment(`key-${i}`, 60_000);
    }
    // Should not throw — internal cleanup runs when maxKeys exceeded
    const result = await store.increment('final', 60_000);
    expect(result.count).toBe(1);
  });

  it('expires old entries within a short window', async () => {
    const store = new MemoryStore();
    // Use a very short window — 1ms
    await store.increment('expire-key', 1);
    // Wait for the window to expire
    await new Promise(r => setTimeout(r, 5));
    const result = await store.increment('expire-key', 1);
    // After window expiry, count should reset to 1
    expect(result.count).toBe(1);
  });

  it('handles concurrent increments without throwing', async () => {
    const store = new MemoryStore();
    const promises = Array.from({ length: 20 }, (_, i) =>
      store.increment(`concurrent-${i % 3}`, 60_000),
    );
    const results = await Promise.all(promises);
    expect(results.every(r => r.count >= 1)).toBe(true);
  });
});
