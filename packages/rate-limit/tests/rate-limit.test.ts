import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimitPlugin, MemoryStore, useRateLimit } from '../src/index';

describe('Rate Limit MemoryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('increments correctly within the window', async () => {
    const store = new MemoryStore();
    const { count: c1 } = await store.increment('ip-1', 60_000);
    const { count: c2 } = await store.increment('ip-1', 60_000);
    expect(c1).toBe(1);
    expect(c2).toBe(2);
  });

  it('slides the window and drops old timestamps', async () => {
    const store = new MemoryStore();
    await store.increment('ip-1', 1000); // 1 sec window

    // Advance 500ms, should still be in window
    vi.advanceTimersByTime(500);
    const { count: c2 } = await store.increment('ip-1', 1000);
    expect(c2).toBe(2);

    // Advance 600ms (total 1100ms), first request drops out
    vi.advanceTimersByTime(600);
    const { count: c3 } = await store.increment('ip-1', 1000);
    expect(c3).toBe(2); // The very first one expired, leaving the 500ms one and this new one
  });

  it('prunes expired keys from memory to prevent OOM leaks', async () => {
    const store = new MemoryStore();
    await store.increment('ip-1', 10_000); // 10 second window

    // Advance 61 seconds to trigger the internal setInterval pruner
    vi.advanceTimersByTime(61_000);

    // The internal map should be empty for that key now
    // We can observe this indirectly by checking a new increment starts at 1
    const { count } = await store.increment('ip-1', 10_000);
    expect(count).toBe(1);
  });
});

describe('useRateLimit Plugin hook', () => {
  const makeMocks = (ip = '127.0.0.1') => {
    const headers: Record<string, string> = {};
    const mockReq = { ip, headers: {} } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockImplementation((k: string, v: string) => {
        headers[k] = v;
      }),
    } as any;
    return { mockReq, mockRes, headers };
  };

  it('applies rate limit headers and blocks on max requests', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useRateLimit(mockApp, { max: 2, windowMs: 1000 });

    const hookFn = mockApp.addHook.mock.calls[0][1];
    const { mockReq, mockRes, headers } = makeMocks();

    // Request 1: Allowed
    await hookFn(mockReq, mockRes);
    expect(headers['X-RateLimit-Remaining']).toBe('1');
    expect(mockRes.status).not.toHaveBeenCalled();

    // Request 2: Allowed
    await hookFn(mockReq, mockRes);
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(mockRes.status).not.toHaveBeenCalled();

    // Request 3: Blocked (429)
    await hookFn(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.send).toHaveBeenCalledWith(null, 'Too Many Requests');
    expect(headers['Retry-After']).toBeDefined();
  });

  it('skips rate limiting if skip function returns true', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useRateLimit(mockApp, {
      max: 1,
      skip: (req) => req.ip === 'whitelist-ip',
    });

    const hookFn = mockApp.addHook.mock.calls[0][1];
    const { mockReq, mockRes } = makeMocks('whitelist-ip');

    // Make 5 requests, should not be blocked
    for (let i = 0; i < 5; i++) {
      await hookFn(mockReq, mockRes);
    }

    expect(mockRes.status).not.toHaveBeenCalled();
  });
});

describe('createRateLimitPlugin aliases', () => {
  it('accepts documented maxRequests and keyExtractor aliases', async () => {
    const limiter = createRateLimitPlugin({
      windowMs: 1000,
      maxRequests: 1,
      keyExtractor: (req) => req.headers['x-client-id'] as string,
    });

    const headers: Record<string, string> = {};
    const req = {
      ip: '127.0.0.1',
      headers: { 'x-client-id': 'client-1' },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockImplementation((key: string, value: string) => {
        headers[key] = value;
      }),
    } as any;

    await limiter(req, res);
    await limiter(req, res);

    expect(headers['X-RateLimit-Limit']).toBe('1');
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
