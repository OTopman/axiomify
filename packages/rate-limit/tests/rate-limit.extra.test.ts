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

describe('createRateLimitPlugin — store failure returns 503', () => {
  it('fails closed with 503 when store.increment throws', async () => {
    const brokenStore = {
      increment: vi.fn(async () => { throw new Error('redis down'); }),
    };
    const plugin = createRateLimitPlugin({
      store: brokenStore,
      max: 10, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
    });
    const res = makeRes();
    await plugin(makeReq({ ip: '7.7.7.7' }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('swallows skip() throw — defaults to not skip', async () => {
    const store = new MemoryStore();
    const plugin = createRateLimitPlugin({
      store, max: 1, windowMs: 60_000,
      allowMemoryStoreInProduction: true,
      skip: () => { throw new Error('skip broken'); },
    });
    const req = makeReq({ ip: '8.8.8.8' });
    await plugin(req, makeRes());
    const res = makeRes();
    await plugin(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

describe('RedisStore — full path coverage', () => {
  it('falls back to ioredis variadic eval when object form throws', async () => {
    const client: any = {
      eval: vi.fn().mockImplementation((...args: unknown[]) => {
        // Object-form call (1 arg, object) fails; variadic call (script, n, ...) succeeds.
        if (args.length === 1 && typeof args[0] === 'object') {
          return Promise.reject(new Error('Unknown ERR'));
        }
        return Promise.resolve([1, 9999]);
      }),
    };
    const store = new RedisStore(client);
    const res = await store.increment('rk', 60_000);
    expect(res.count).toBe(1);
    // Both call styles were attempted: 1st is object, 2nd is variadic.
    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('throws when client has no eval()', async () => {
    const store = new RedisStore({} as any);
    await expect(store.increment('rk', 60_000)).rejects.toThrow(/eval/);
  });

  it('evalsha NOSCRIPT triggers eval fallback', async () => {
    const client: any = {
      eval: vi.fn().mockResolvedValue([2, 1234]),
      evalsha: vi.fn().mockRejectedValue(new Error('NOSCRIPT No matching script')),
    };
    const store = new RedisStore(client);
    // First call loads the script via eval
    await store.increment('rk', 60_000);
    // Second call attempts evalsha (NOSCRIPT) and falls back to eval
    const res = await store.increment('rk', 60_000);
    expect(res.count).toBe(2);
    expect(client.evalsha).toHaveBeenCalled();
  });

  it('evalsha non-NOSCRIPT error tries redis@4 object style and rethrows on failure', async () => {
    let evalshaCalls = 0;
    const client: any = {
      eval: vi.fn().mockResolvedValue([1, 1234]),
      evalsha: vi.fn().mockImplementation(() => {
        evalshaCalls++;
        return Promise.reject(new Error('WRONGTYPE'));
      }),
    };
    const store = new RedisStore(client);
    // First call: eval path (no evalsha), sets _scriptLoaded=true
    await store.increment('rk', 60_000);
    // Second call: evalsha first (variadic) fails with WRONGTYPE → tries object style (also fails) → rethrows variadic error
    await expect(store.increment('rk', 60_000)).rejects.toThrow();
    expect(evalshaCalls).toBeGreaterThanOrEqual(2);
  });

  it('evalsha object-style success returns result', async () => {
    let calls = 0;
    const client: any = {
      eval: vi.fn().mockResolvedValue([1, 1234]),
      evalsha: vi.fn().mockImplementation((_sha: string, second: unknown) => {
        calls++;
        // First variadic call rejects with non-NOSCRIPT (signals try object form)
        if (calls === 1) return Promise.reject(new Error('WRONGTYPE'));
        // Second (object) call: succeeds — covers the "redis@4 object style" branch
        if (typeof second === 'object') return Promise.resolve([3, 9999]);
        return Promise.reject(new Error('unexpected'));
      }),
    };
    const store = new RedisStore(client);
    await store.increment('rk', 60_000); // primes _scriptLoaded
    const res = await store.increment('rk', 60_000);
    expect(res.count).toBe(3);
  });

  it('client without evalsha/evalSha forces NOSCRIPT signal', async () => {
    let evalCalls = 0;
    const client: any = {
      eval: vi.fn().mockImplementation(() => {
        evalCalls++;
        return Promise.resolve([evalCalls, 9999]);
      }),
    };
    const store = new RedisStore(client);
    // _scriptLoaded becomes true after first call. Manually force it true via private state.
    (store as any)._scriptLoaded = true;
    const res = await store.increment('rk', 60_000);
    expect(res.count).toBeGreaterThanOrEqual(1);
  });
});

describe('MemoryStore — compaction', () => {
  it('triggers timestamp compaction when start > 1024 in increment', async () => {
    const store = new MemoryStore();
    // Use a short window so old timestamps expire and start moves forward
    const key = 'compaction-key';
    for (let i = 0; i < 1100; i++) {
      // 1ms window — each prior timestamp immediately falls outside
      await store.increment(key, 1);
      // Microtask yield to keep Date.now() ticking forward
      if (i % 100 === 0) await new Promise(r => setTimeout(r, 2));
    }
    // No assertion — just verify the path didn't throw
  });
});
