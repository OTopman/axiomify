import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseClient, SdkError } from '../src/index';
import { LruTtlCache } from '../src/cache';
import { CircuitBreaker, CircuitBreakerError } from '../src/circuit-breaker';
import { EnvironmentSwitcher } from '../src/environment';
import { Paginator } from '../src/pagination';
import { OfflineQueue } from '../src/offline';
import { StaticTokenProvider, OAuth2BearerProvider } from '../src/auth';
import { InterceptorManager } from '../src/interceptors';
import { safeJsonStringify, isBinaryData } from '../src/serializer';
import { withRetry } from '../src/retry';
import { SseClient } from '../src/sse';
import { WebSocketClient } from '../src/websocket';

// Cache original globals
const originalFetch = globalThis.fetch;
const originalNavigator = (globalThis as any).navigator;
const originalWindow = (globalThis as any).window;
const originalWebSocket = (globalThis as any).WebSocket;

let mockNow = 1000000;

function stubNavigator(props: Record<string, any>) {
  Object.defineProperty(globalThis, 'navigator', {
    value: props,
    writable: true,
    configurable: true,
  });
}

function stubWindow(props: Record<string, any>) {
  Object.defineProperty(globalThis, 'window', {
    value: props,
    writable: true,
    configurable: true,
  });
}

describe('@axiomify/sdk-runtime tests', () => {
  beforeEach(() => {
    mockNow = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
    stubNavigator({ onLine: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    (globalThis as any).navigator = originalNavigator;
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
  });

  // 1. cache.ts Tests
  describe('LruTtlCache', () => {
    it('should set and get values within TTL', () => {
      const cache = new LruTtlCache(3, 100); // 100ms TTL
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);

      mockNow += 101;
      expect(cache.get('a')).toBeNull();
    });

    it('should evict oldest item when capacity is reached (LRU)', () => {
      const cache = new LruTtlCache(2, 1000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // 'a' should be evicted

      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('should refresh access order on get', () => {
      const cache = new LruTtlCache(2, 1000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // Make 'a' most recently used
      cache.set('c', 3); // 'b' should be evicted instead of 'a'

      expect(cache.get('b')).toBeNull();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
    });

    it('should overwrite existing keys and refresh order', () => {
      const cache = new LruTtlCache(2, 1000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('a', 10); // Update 'a'
      cache.set('c', 3); // 'b' evicted

      expect(cache.get('b')).toBeNull();
      expect(cache.get('a')).toBe(10);
      expect(cache.get('c')).toBe(3);
    });

    it('should delete and clear entries', () => {
      const cache = new LruTtlCache(5, 1000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.delete('a');
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBe(2);

      cache.clear();
      expect(cache.get('b')).toBeNull();
    });
  });

  // 2. circuit-breaker.ts Tests
  describe('CircuitBreaker', () => {
    it('should execute successfully when CLOSED', async () => {
      const cb = new CircuitBreaker();
      const result = await cb.run(async () => 'hello');
      expect(result).toBe('hello');
      expect(cb.getState()).toBe('CLOSED');
    });

    it('should trip to OPEN when failures exceed threshold', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        cooldownPeriodMs: 1000,
        halfOpenMaxProbeRequests: 2,
      });

      const failingTask = () => Promise.reject(new Error('fail'));

      await expect(cb.run(failingTask)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('CLOSED');

      await expect(cb.run(failingTask)).rejects.toThrow('fail');
      expect(cb.getState()).toBe('OPEN');

      // Request should fail immediately without executing function
      const spy = vi.fn();
      await expect(cb.run(spy)).rejects.toThrow(CircuitBreakerError);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after cooldown', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
        halfOpenMaxProbeRequests: 2,
      });

      await expect(
        cb.run(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow('fail');
      expect(cb.getState()).toBe('OPEN');

      mockNow += 1001;

      // The next call will evaluate checkState() and move to HALF_OPEN
      let count = 0;
      const result = await cb.run(async () => {
        count++;
        return 'success';
      });
      expect(result).toBe('success');
      expect(cb.getState()).toBe('HALF_OPEN');

      // In HALF_OPEN, second success will transition to CLOSED (since max is 2)
      await cb.run(async () => 'success');
      expect(cb.getState()).toBe('CLOSED');
    });

    it('should return to OPEN if HALF_OPEN request fails', async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        cooldownPeriodMs: 1000,
        halfOpenMaxProbeRequests: 2,
      });

      await expect(
        cb.run(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow('fail');
      expect(cb.getState()).toBe('OPEN');

      mockNow += 1001;

      await expect(
        cb.run(() => Promise.reject(new Error('another fail'))),
      ).rejects.toThrow('another fail');
      expect(cb.getState()).toBe('OPEN');
    });
  });

  // 3. environment.ts Tests
  describe('EnvironmentSwitcher', () => {
    const config = {
      production: 'https://prod.com',
      staging: 'https://stage.com',
      development: 'http://localhost',
    };

    it('should set default environment and allow changes', () => {
      const sw = new EnvironmentSwitcher(config, 'development');
      expect(sw.getCurrentEnvironment()).toBe('development');
      expect(sw.getUrl()).toBe('http://localhost');

      sw.setEnvironment('production');
      expect(sw.getCurrentEnvironment()).toBe('production');
      expect(sw.getUrl()).toBe('https://prod.com');
    });

    it('should throw error when environment is not configured', () => {
      const sw = new EnvironmentSwitcher(config);
      expect(sw.getCurrentEnvironment()).toBe('production');
      expect(() => sw.setEnvironment('test')).toThrow(
        'Environment "test" is not configured.',
      );
    });
  });

  // 4. pagination.ts Tests
  describe('Paginator', () => {
    it('should page correctly until no more pages remain', async () => {
      const pages = [
        { items: [1, 2], nextCursor: 'c1', hasMore: true },
        { items: [3, 4], nextCursor: 'c2', hasMore: true },
        { items: [5], hasMore: false },
      ];

      const fetchPage = vi.fn().mockImplementation(async (params) => {
        const cursor = params.cursor;
        if (!cursor) return pages[0];
        if (cursor === 'c1') return pages[1];
        return pages[2];
      });

      const paginator = new Paginator({
        fetchPage,
        initialParams: { cursor: undefined },
        cursorParamName: 'cursor',
      });

      expect(paginator.hasNext()).toBe(true);

      const p1 = await paginator.nextPage();
      expect(p1).toEqual([1, 2]);
      expect(fetchPage).toHaveBeenLastCalledWith({ cursor: undefined });

      expect(paginator.hasNext()).toBe(true);
      const p2 = await paginator.nextPage();
      expect(p2).toEqual([3, 4]);
      expect(fetchPage).toHaveBeenLastCalledWith({ cursor: 'c1' });

      expect(paginator.hasNext()).toBe(true);
      const p3 = await paginator.nextPage();
      expect(p3).toEqual([5]);
      expect(fetchPage).toHaveBeenLastCalledWith({ cursor: 'c2' });

      expect(paginator.hasNext()).toBe(false);
      const p4 = await paginator.nextPage();
      expect(p4).toEqual([]);
    });

    it('should infer hasMore if not returned', async () => {
      const paginator = new Paginator({
        fetchPage: async () => ({ items: [1], nextCursor: undefined }),
        initialParams: {},
        cursorParamName: 'cursor',
      });
      await paginator.nextPage();
      expect(paginator.hasNext()).toBe(false);
    });
  });

  // 5. offline.ts Tests
  describe('OfflineQueue', () => {
    it('should enqueue and retrieve items', () => {
      const q = new OfflineQueue();
      q.enqueue({ path: '/test', method: 'GET' });
      const items = q.getQueue();
      expect(items.length).toBe(1);
      expect(items[0].path).toBe('/test');
      expect(items[0].id).toBeTypeOf('string');
      expect(items[0].timestamp).toBeTypeOf('number');

      q.clear();
      expect(q.getQueue().length).toBe(0);
    });

    it('should flush queue using processor', async () => {
      stubNavigator({ onLine: true });
      const q = new OfflineQueue();
      q.enqueue({ path: '/a', method: 'POST' });
      q.enqueue({ path: '/b', method: 'PUT' });

      const processed: string[] = [];
      await q.flush(async (req) => {
        processed.push(req.path);
      });

      expect(processed).toEqual(['/a', '/b']);
      expect(q.getQueue().length).toBe(0);
    });

    it('should re-enqueue failed items during flush', async () => {
      stubNavigator({ onLine: true });
      const q = new OfflineQueue();
      q.enqueue({ path: '/ok', method: 'POST' });
      q.enqueue({ path: '/fail', method: 'POST' });

      const processed: string[] = [];
      await q.flush(async (req) => {
        processed.push(req.path);
        if (req.path === '/fail') throw new Error('Network error');
      });

      expect(processed).toEqual(['/ok', '/fail']);
      expect(q.getQueue().length).toBe(1);
      expect(q.getQueue()[0].path).toBe('/fail');
    });

    it('should skip flush if offline in navigator', async () => {
      stubNavigator({ onLine: false });

      const q = new OfflineQueue();
      q.enqueue({ path: '/test', method: 'GET' });

      const processor = vi.fn();
      await q.flush(processor);

      expect(processor).not.toHaveBeenCalled();
      expect(q.getQueue().length).toBe(1);
    });

    it('should trigger flush on online event if in window environment', () => {
      const listeners: Record<string, any> = {};
      stubWindow({
        addEventListener: (event: string, cb: any) => {
          listeners[event] = cb;
        },
      });

      const q = new OfflineQueue();
      const spy = vi.spyOn(q, 'flush');

      expect(listeners['online']).toBeDefined();
      listeners['online']();
      expect(spy).toHaveBeenCalled();
    });
  });

  // 6. auth.ts Tests
  describe('StaticTokenProvider & OAuth2BearerProvider', () => {
    it('StaticTokenProvider should return static token', async () => {
      const prov = new StaticTokenProvider('my-token');
      const t = await prov.getToken();
      expect(t).toBe('my-token');
    });

    it('OAuth2BearerProvider should fetch new token and cache it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'abc', expires_in: 60 }),
      });
      globalThis.fetch = mockFetch;

      const prov = new OAuth2BearerProvider(
        'http://auth',
        'id',
        'secret',
        'scope1',
      );
      const t1 = await prov.getToken();
      expect(t1).toBe('Bearer abc');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify URLSearchParams passed to fetch body
      const fetchCallArgs = mockFetch.mock.calls[0];
      expect(fetchCallArgs[0]).toBe('http://auth');
      expect(fetchCallArgs[1].method).toBe('POST');
      expect(fetchCallArgs[1].headers).toEqual({
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      expect(fetchCallArgs[1].body).toContain('grant_type=client_credentials');
      expect(fetchCallArgs[1].body).toContain('client_id=id');
      expect(fetchCallArgs[1].body).toContain('client_secret=secret');
      expect(fetchCallArgs[1].body).toContain('scope=scope1');

      // T2 should use cached token (no fetch)
      const t2 = await prov.getToken();
      expect(t2).toBe('Bearer abc');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Fast-forward past expiration buffer
      mockNow += 51000; // 60s - 10s buffer is 50s. 51s should trigger refresh.

      const t3 = await prov.getToken();
      expect(t3).toBe('Bearer abc');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('OAuth2BearerProvider should throw if fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const prov = new OAuth2BearerProvider('http://auth', 'id', 'secret');
      await expect(prov.getToken()).rejects.toThrow(
        'Failed to fetch OAuth2 token: 401',
      );
    });
  });

  // 7. interceptors.ts Tests
  describe('InterceptorManager', () => {
    it('should process request interceptors sequentially', async () => {
      const manager = new InterceptorManager();
      manager.useRequest(async (req) => {
        req.headers = { ...req.headers, x1: '1' };
        return req;
      });
      manager.useRequest((req) => {
        req.headers = { ...req.headers, x2: '2' };
        return req;
      });

      const result = await manager.runRequestInterceptors({
        path: '/test',
        method: 'GET',
      });
      expect(result.headers).toEqual({ x1: '1', x2: '2' });
    });

    it('should process response interceptors sequentially', async () => {
      const manager = new InterceptorManager();
      manager.useResponse(async (res) => {
        res.status = 201;
        return res;
      });
      manager.useResponse((res) => {
        res.data = 'intercepted';
        return res;
      });

      const result = await manager.runResponseInterceptors({
        status: 200,
        headers: new Headers(),
        data: 'original',
        request: { path: '/', method: 'GET' },
      });

      expect(result.status).toBe(201);
      expect(result.data).toBe('intercepted');
    });

    it('should process error interceptors sequentially', async () => {
      const manager = new InterceptorManager();
      manager.useError(async (err) => {
        err.message = 'custom error';
        return err;
      });
      manager.useError((err) => {
        throw new Error('thrown in interceptor: ' + err.message);
      });

      await expect(
        manager.runErrorInterceptors(new Error('original')),
      ).rejects.toThrow('thrown in interceptor: custom error');
    });
  });

  // 8. serializer.ts Tests
  describe('safeJsonStringify & isBinaryData', () => {
    it('safeJsonStringify should format bigint and Date values', () => {
      const date = new Date('2026-05-27T12:00:00.000Z');
      const obj = {
        num: 42,
        big: 12345678901234567890n,
        date: date,
      };

      const result = safeJsonStringify(obj);
      expect(result).toBe(
        '{"num":42,"big":"12345678901234567890","date":"2026-05-27T12:00:00.000Z"}',
      );
    });

    it('safeJsonStringify should format Date when toJSON is undefined', () => {
      const date = new Date('2026-05-27T12:00:00.000Z');
      (date as any).toJSON = undefined;
      const obj = { date };
      const result = safeJsonStringify(obj);
      expect(result).toBe('{"date":"2026-05-27T12:00:00.000Z"}');
    });

    it('isBinaryData should identify binary formats', () => {
      expect(isBinaryData(null)).toBe(false);
      expect(isBinaryData(undefined)).toBe(false);
      expect(isBinaryData('string')).toBe(false);
      expect(isBinaryData({})).toBe(false);

      expect(isBinaryData(new ArrayBuffer(8))).toBe(true);
      expect(isBinaryData(new Uint8Array(8))).toBe(true);
      expect(isBinaryData(Buffer.from('hello'))).toBe(true);

      if (typeof Blob !== 'undefined') {
        expect(isBinaryData(new Blob())).toBe(true);
      }
      if (typeof File !== 'undefined') {
        expect(isBinaryData(new File([], 'x.txt'))).toBe(true);
      }
    });
  });

  // 9. retry.ts Tests
  describe('withRetry', () => {
    it('should resolve if operation succeeds first try', async () => {
      const task = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(task);
      expect(result).toBe('ok');
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error status codes and eventually succeed', async () => {
      let count = 0;
      const task = vi.fn().mockImplementation(async () => {
        count++;
        if (count < 3) {
          const err = new Error('Gateway Error');
          (err as any).status = 502;
          throw err;
        }
        return 'success';
      });

      const p = withRetry(task, { baseDelayMs: 0, maxRetries: 3 });
      const result = await p;

      expect(result).toBe('success');
      expect(task).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable status codes', async () => {
      const task = vi.fn().mockImplementation(async () => {
        const err = new Error('Unprocessable');
        (err as any).status = 422;
        throw err;
      });

      const p = withRetry(task, { baseDelayMs: 0, maxRetries: 3 });
      await expect(p).rejects.toThrow('Unprocessable');
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('should fail when max retries exceeded', async () => {
      const task = vi.fn().mockImplementation(async () => {
        const err = new Error('Timeout');
        (err as any).status = 408;
        throw err;
      });

      const p = withRetry(task, { baseDelayMs: 0, maxRetries: 2 });
      await expect(p).rejects.toThrow('Timeout');
      expect(task).toHaveBeenCalledTimes(3); // Initial try + 2 retries
    });
  });

  // 10. sse.ts Tests
  describe('SseClient', () => {
    it('should connect and parse simple SSE event strings', async () => {
      let resolveStream: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve;
      });

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            value: new TextEncoder().encode(
              'event: update\ndata: {"val":1}\n\n',
            ),
            done: false,
          })
          .mockResolvedValueOnce({
            value: new TextEncoder().encode(
              ':comment here\ndata: second-message\n\n',
            ),
            done: false,
          })
          .mockResolvedValueOnce({ done: true }),
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const openSpy = vi.fn();
      let messageCount = 0;
      const messageSpy = vi.fn().mockImplementation(() => {
        messageCount++;
        if (messageCount === 2) {
          sse.disconnect();
          resolveStream();
        }
      });

      const sse = new SseClient('http://sse', {
        onOpen: openSpy,
        onMessage: messageSpy,
        baseDelayMs: 0,
        maxRetries: 1,
      });

      sse.connect();

      await streamPromise;

      expect(openSpy).toHaveBeenCalled();
      expect(messageSpy).toHaveBeenCalledTimes(2);
      expect(messageSpy).toHaveBeenNthCalledWith(1, 'update', '{"val":1}');
      expect(messageSpy).toHaveBeenNthCalledWith(
        2,
        'message',
        'second-message',
      );
    });

    it('should back off and reconnect on network failure', async () => {
      let resolveStream: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve;
      });

      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error('Network disconnected'));

      let errorCount = 0;
      const errorSpy = vi.fn().mockImplementation((err) => {
        errorCount++;
        if (err.message.includes('Max SSE reconnection retries')) {
          resolveStream();
        }
      });

      const sse = new SseClient('http://sse', {
        onError: errorSpy,
        baseDelayMs: 0,
        maxRetries: 2,
      });

      sse.connect();

      await streamPromise;

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: 'Max SSE reconnection retries reached',
        }),
      );
    });

    it('should handle non-ok SSE HTTP response status', async () => {
      let resolveStream: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve;
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const errorSpy = vi.fn().mockImplementation((err) => {
        if (
          err.message.includes('SSE HTTP failure: 500') ||
          err.message.includes('Max SSE reconnection retries reached')
        ) {
          resolveStream();
        }
      });

      const sse = new SseClient('http://sse', {
        onError: errorSpy,
        baseDelayMs: 0,
        maxRetries: 1,
      });

      sse.connect();
      await streamPromise;
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should throw error if response body is not readable', async () => {
      let resolveStream: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        resolveStream = resolve;
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: null,
      });

      const errorSpy = vi.fn().mockImplementation((err) => {
        if (
          err.message.includes('Response body is not readable') ||
          err.message.includes('Max SSE reconnection retries reached')
        ) {
          resolveStream();
        }
      });

      const sse = new SseClient('http://sse', {
        onError: errorSpy,
        baseDelayMs: 0,
        maxRetries: 1,
      });

      sse.connect();
      await streamPromise;
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should handle AbortError silently on disconnect', async () => {
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          const err = new DOMException(
            'The user aborted a request.',
            'AbortError',
          );
          throw err;
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const errorSpy = vi.fn();
      const sse = new SseClient('http://sse', {
        onError: errorSpy,
        baseDelayMs: 0,
        maxRetries: 1,
      });

      sse.connect();
      sse.disconnect();

      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // 11. websocket.ts Tests
  describe('WebSocketClient', () => {
    it('should connect, handle message, send message, and close', async () => {
      const mockWsInstance = {
        readyState: 1, // OPEN
        send: vi.fn(),
        close: vi.fn(),
      };

      const WSClassMock = vi.fn().mockImplementation(function () {
        return mockWsInstance;
      });
      (globalThis as any).WebSocket = WSClassMock;

      const openSpy = vi.fn();
      const closeSpy = vi.fn();
      const messageSpy = vi.fn();

      const client = new WebSocketClient('ws://test', {
        onOpen: openSpy,
        onClose: closeSpy,
        onMessage: messageSpy,
        heartbeatIntervalMs: 10,
        baseDelayMs: 0,
        maxRetries: 2,
      });

      client.connect();
      expect(WSClassMock).toHaveBeenCalledWith('ws://test');

      // Trigger open callback
      (mockWsInstance as any).onopen();
      expect(openSpy).toHaveBeenCalled();

      // Trigger message
      (mockWsInstance as any).onmessage({ data: 'hello' });
      expect(messageSpy).toHaveBeenCalledWith('hello');

      // Send message
      client.send('ping-server');
      expect(mockWsInstance.send).toHaveBeenCalledWith('ping-server');

      // Heartbeat ping verification (wait a bit for interval)
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(mockWsInstance.send).toHaveBeenLastCalledWith('ping');

      // Trigger close
      (mockWsInstance as any).onclose();
      expect(closeSpy).toHaveBeenCalled();

      client.disconnect();
      expect(mockWsInstance.close).toHaveBeenCalled();
    });

    it('should reconnect on close', async () => {
      let resolveReconnect: () => void;
      const reconnectPromise = new Promise<void>((resolve) => {
        resolveReconnect = resolve;
      });

      const mockWsInstance = {
        close: vi.fn(),
      };

      let wsInstantiationCount = 0;
      const WSClassMock = vi.fn().mockImplementation(function () {
        wsInstantiationCount++;
        if (wsInstantiationCount === 2) {
          resolveReconnect();
        }
        return mockWsInstance;
      });
      (globalThis as any).WebSocket = WSClassMock;

      const client = new WebSocketClient('ws://reconnect', {
        baseDelayMs: 0,
        maxRetries: 2,
      });

      client.connect();
      (mockWsInstance as any).onclose();

      await reconnectPromise;

      expect(wsInstantiationCount).toBe(2);
    });

    it('should handle disconnect when not connected', () => {
      const client = new WebSocketClient('ws://test');
      expect(() => client.disconnect()).not.toThrow();
    });

    it('should throw error when sending on unopened client', () => {
      const client = new WebSocketClient('ws://test');
      expect(() => client.send('hello')).toThrow('WebSocket is not open');
    });

    it('should handle constructor throw and reconnect', async () => {
      const WSClassMock = vi.fn().mockImplementation(function () {
        throw new Error('Constructor failed');
      });
      (globalThis as any).WebSocket = WSClassMock;

      const errorSpy = vi.fn();
      const client = new WebSocketClient('ws://test', {
        onError: errorSpy,
        baseDelayMs: 0,
        maxRetries: 1,
      });

      client.connect();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Constructor failed' }),
      );
    });

    it('should handle max retries exceeded', async () => {
      const WSClassMock = vi.fn().mockImplementation(function () {
        throw new Error('Connection failed');
      });
      (globalThis as any).WebSocket = WSClassMock;

      const errorSpy = vi.fn();
      const client = new WebSocketClient('ws://test', {
        onError: errorSpy,
        baseDelayMs: 0,
        maxRetries: 1,
      });

      client.connect();
      // Wait for reconnect attempt to fire and fail
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Max WebSocket reconnection retries reached',
        }),
      );
    });

    it('should trigger close on heartbeat send failure', async () => {
      const mockWsInstance = {
        readyState: 1,
        send: vi.fn().mockImplementation(() => {
          throw new Error('Send failed');
        }),
        close: vi.fn(),
      };
      (globalThis as any).WebSocket = vi
        .fn()
        .mockImplementation(function () {
          return mockWsInstance;
        });

      const client = new WebSocketClient('ws://test', {
        heartbeatIntervalMs: 5,
        baseDelayMs: 0,
      });

      client.connect();
      (mockWsInstance as any).onopen();

      // wait for heartbeat timer to fire
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockWsInstance.close).toHaveBeenCalled();
    });

    it('should fallback to require("ws") when globalThis.WebSocket is undefined', () => {
      const originalWS = (globalThis as any).WebSocket;
      (globalThis as any).WebSocket = undefined;

      const client = new WebSocketClient('ws://127.0.0.1:9999', {
        baseDelayMs: 0,
        maxRetries: 0,
      });

      try {
        client.connect();
      } catch (err) {
        // Ignore any errors from constructor or network
      } finally {
        client.disconnect();
        (globalThis as any).WebSocket = originalWS;
      }
    });
  });

  // 12. client.ts Tests (BaseClient)
  describe('BaseClient', () => {
    it('should perform basic request fetching and cache GETs', async () => {
      const headers = new Headers();
      headers.set('content-type', 'application/json');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers,
        json: async () => ({ res: 'ok' }),
      });

      const client = new BaseClient({
        baseUrl: 'https://api.test',
        enableCache: true,
        cacheTtlMs: 1000,
        fetch: mockFetch,
      });

      const res = await client['request']({
        path: '/items',
        method: 'GET',
        query: { limit: 10 },
      });

      expect(res).toEqual({ res: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify request parameter construction
      const fetchArgs = mockFetch.mock.calls[0];
      expect(fetchArgs[0]).toBe('https://api.test/items?limit=10');

      // Second identical request should return from cache
      const resCached = await client['request']({
        path: '/items',
        method: 'GET',
        query: { limit: 10 },
      });
      expect(resCached).toEqual({ res: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1 call!
    });

    it('should support telemetry hooks, token injection, and body formatting', async () => {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      });

      const tokenProvider = {
        getToken: vi.fn().mockReturnValue('Bearer super-token'),
      };

      const beforeSpy = vi.fn();
      const afterSpy = vi.fn();

      const client = new BaseClient({
        baseUrl: 'https://api.test',
        authProvider: tokenProvider,
        telemetry: {
          onBeforeRequest: beforeSpy,
          onAfterResponse: afterSpy,
        },
        fetch: mockFetch,
      });

      const payload = { data: 'test' };
      const res = await client['request']({
        path: '/save',
        method: 'POST',
        body: payload,
      });

      expect(res).toEqual({ success: true });
      expect(tokenProvider.getToken).toHaveBeenCalled();
      expect(beforeSpy).toHaveBeenCalled();
      expect(afterSpy).toHaveBeenCalled();

      // Check request format (headers contain injected token and json Content-Type)
      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.method).toBe('POST');
      expect(fetchOpts.headers.get('Authorization')).toBe('Bearer super-token');
      expect(fetchOpts.headers.get('Content-Type')).toBe('application/json');
      expect(fetchOpts.body).toBe(JSON.stringify(payload));
    });

    it('should format binary payload in POST requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => 'binary-received',
      });

      const client = new BaseClient({
        baseUrl: 'https://api.test',
        fetch: mockFetch,
      });

      const binaryData = new Uint8Array([1, 2, 3]);
      await client['request']({
        path: '/upload',
        method: 'POST',
        body: binaryData,
      });

      const fetchOpts = mockFetch.mock.calls[0][1];
      expect(fetchOpts.headers.get('Content-Type')).toBe(
        'application/octet-stream',
      );
      expect(fetchOpts.body).toBe(binaryData);
    });

    it('should support in-flight request deduplication', async () => {
      let resolvePromise: any;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const headers = new Headers();
      headers.set('content-type', 'application/json');
      const mockFetch = vi.fn().mockImplementation(async () => {
        await delayedPromise;
        return {
          ok: true,
          status: 200,
          headers,
          json: async () => ({ data: 'dedup' }),
          text: async () => JSON.stringify({ data: 'dedup' }),
        };
      });

      const client = new BaseClient({
        baseUrl: 'https://api.test',
        fetch: mockFetch,
      });

      const p1 = client['request']({ path: '/dedup', method: 'GET' });
      const p2 = client['request']({ path: '/dedup', method: 'GET' });

      resolvePromise();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual({ data: 'dedup' });
      expect(r2).toEqual({ data: 'dedup' });
      expect(mockFetch).toHaveBeenCalledTimes(1); // Called only once!
    });

    it('should throw timeout error if timeoutMs is exceeded', async () => {
      // Mock fetch that hangs
      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        const signal = opts.signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      });

      const errorSpy = vi.fn();
      const client = new BaseClient({
        baseUrl: 'https://api.test',
        timeoutMs: 10,
        fetch: mockFetch,
        telemetry: {
          onError: errorSpy,
        },
      });

      const p = client['request']({ path: '/hang', method: 'GET' });

      await expect(p).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should run interceptors and handles errors', async () => {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers,
        json: async () => ({ error: 'Bad Request' }),
        text: async () => JSON.stringify({ error: 'Bad Request' }),
      });

      const client = new BaseClient({
        baseUrl: 'https://api.test',
        fetch: mockFetch,
      });

      client.interceptors.useError((err) => {
        throw new Error('intercepted: ' + err.message);
      });

      await expect(
        client['request']({ path: '/bad', method: 'GET' }),
      ).rejects.toThrow('intercepted: API Error: 400');
    });

    it('should format FormData payload and forward custom request headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => 'form-data-received',
      });

      const client = new BaseClient({
        baseUrl: 'https://api.test',
        fetch: mockFetch,
      });

      if (typeof FormData !== 'undefined') {
        const formData = new FormData();
        formData.append('key', 'value');

        await client['request']({
          path: '/form',
          method: 'POST',
          headers: {
            'X-Custom-Header': 'custom-value',
          },
          body: formData,
        });

        const fetchOpts = mockFetch.mock.calls[0][1];
        expect(fetchOpts.headers.get('X-Custom-Header')).toBe('custom-value');
        expect(fetchOpts.body).toBe(formData);
      }
    });
  });
});
