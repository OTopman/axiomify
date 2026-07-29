/**
 * @axiomify/cache + @axiomify/compress — cross-plugin regression tests.
 *
 * Both plugins wrap res.send/res.sendRaw from independent onRequest hooks.
 * Two things must hold when they're stacked on the same app:
 *
 *  1. The response serializer runs exactly ONCE per request, not once per
 *     plugin (each plugin used to re-run it when delegating to the other).
 *  2. Registration order never corrupts the cache: a response cache/compress
 *     wrap around must never store already-content-encoded bytes.
 *
 * Note: `makeSerialize()` (core) probes the raw serializer once, the FIRST
 * time each plugin's memoized wrapper is built — a one-time cost, not a
 * per-request one. Every test below issues a throwaway warm-up request
 * (clearing the cache store afterward) before resetting the call counter,
 * so the assertion measures steady-state per-request cost only.
 */
import { describe, expect, it } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useCache, MemoryCacheStore, type CacheStore } from '../src/index';
import { useCompress } from '@axiomify/compress';

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1',
    method: 'GET',
    url: '/data',
    path: '/data',
    ip: '127.0.0.1',
    headers: { 'accept-encoding': 'gzip' },
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  };
}

function makeRes(overrides: any = {}): any {
  const headers: Record<string, string> = {};
  let sent = false;
  let rawBody: unknown;
  const res: any = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    header(k: string, v: string) {
      headers[k] = v;
      return res;
    },
    getHeader(k: string) {
      return headers[k];
    },
    removeHeader(k: string) {
      delete headers[k];
      return res;
    },
    send(data: any, message?: string) {
      if (sent) return;
      sent = true;
      rawBody = data;
    },
    sendRaw(payload: any) {
      if (sent) return;
      sent = true;
      rawBody = payload;
    },
    stream() {},
    get headersSent() {
      return sent;
    },
    get rawBody() {
      return rawBody;
    },
    headers,
    raw: {},
    capabilities: { sse: false, streaming: false },
    ...overrides,
  };
  return res;
}

/** Issues a throwaway request to warm up both plugins' memoized serializer
 *  wrappers, then wipes the store so it doesn't leave a cache HIT behind. */
async function warmUp(app: Axiomify, store: CacheStore): Promise<void> {
  await app.handle(makeReq(), makeRes());
  await store.clear();
}

describe('useCompress + useCache stacked on one app', () => {
  it('runs the serializer exactly once per request (documented safe order)', async () => {
    const app = new Axiomify();
    let serializeCalls = 0;
    app.setSerializer((input) => {
      serializeCalls++;
      return {
        status: input.isError ? 'failed' : 'success',
        message: input.message ?? 'Operation successful',
        data: input.data,
      };
    });

    // Documented safe order: compress registers first (ends up innermost),
    // cache second.
    const store = new MemoryCacheStore();
    useCompress(app, { threshold: 1 }); // low threshold so it always transforms
    useCache(app, { store, routes: ['/'] });

    app.route({
      method: 'GET',
      path: '/data',
      handler: async (_req, res) => {
        res.send({ n: 1, padding: 'x'.repeat(50) });
      },
    });

    await warmUp(app, store);
    serializeCalls = 0;

    await app.handle(makeReq(), makeRes());
    expect(serializeCalls).toBe(1);
  });

  it('never double-serializes regardless of plugin registration order', async () => {
    const app = new Axiomify();
    let serializeCalls = 0;
    app.setSerializer((input) => {
      serializeCalls++;
      return { status: 'success', message: 'ok', data: input.data };
    });

    // Unsafe order: cache registers first. The Content-Encoding guard
    // (a separate fix) keeps this from corrupting the cache; this test only
    // asserts the serializer call count, independent of that fix.
    //
    // Threshold is intentionally ABOVE this payload's size: compress's
    // "compress and delegate via sendRaw" path never re-serializes by
    // construction (it hands off pre-serialized bytes either way) — the
    // double-serialization bug lives specifically in the "payload too
    // small to compress, delegate via send()" fast path, so the test must
    // exercise THAT path to be meaningful.
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    useCompress(app, { threshold: 1024 });

    app.route({
      method: 'GET',
      path: '/data',
      handler: async (_req, res) => {
        res.send({ n: 1 });
      },
    });

    await warmUp(app, store);
    serializeCalls = 0;

    await app.handle(makeReq(), makeRes());
    expect(serializeCalls).toBe(1);
  });

  it('below compress threshold: still serializes exactly once', async () => {
    const app = new Axiomify();
    let serializeCalls = 0;
    app.setSerializer((input) => {
      serializeCalls++;
      return { status: 'success', message: 'ok', data: input.data };
    });

    const store = new MemoryCacheStore();
    useCompress(app); // default threshold (1024) — this payload won't compress
    useCache(app, { store, routes: ['/'] });

    app.route({
      method: 'GET',
      path: '/data',
      handler: async (_req, res) => {
        res.send({ tiny: true });
      },
    });

    await warmUp(app, store);
    serializeCalls = 0;

    const res = makeRes();
    await app.handle(makeReq(), res);
    expect(serializeCalls).toBe(1);
    expect(JSON.parse(res.rawBody as string)).toEqual({
      status: 'success',
      message: 'ok',
      data: { tiny: true },
    });
  });
});
