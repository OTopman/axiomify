import { Axiomify } from '@axiomify/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryCacheStore,
  cacheControl,
  cached,
  computeEtag,
  createCacheModule,
  noCache,
  useCache,
} from '../src/index';

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1',
    method: 'GET',
    url: '/',
    path: '/',
    ip: '127.0.0.1',
    headers: {},
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
  const res: any = {
    statusCode: 200,
    sentData: undefined as unknown,
    sentMessage: undefined as string | undefined,
    rawBody: undefined as unknown,
    rawContentType: undefined as string | undefined,
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
      res.sentData = data;
      res.sentMessage = message;
    },
    sendRaw(payload: any, contentType?: string) {
      if (sent) return;
      sent = true;
      res.rawBody = payload;
      res.rawContentType = contentType;
    },
    stream() { },
    get headersSent() {
      return sent;
    },
    headers,
    raw: {},
    capabilities: { sse: false, streaming: false },
    ...overrides,
  };
  return res;
}

/** Body the default serializer + JSON.stringify produce for res.send(data). */
function defaultBody(data: unknown): string {
  return JSON.stringify({
    status: 'success',
    message: 'Operation successful',
    data,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ETag / conditional GET', () => {
  function makeApp(cacheOptions: any = {}) {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    const api = useCache(app, { store, ...cacheOptions });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/data',
      handler: async (_req, res) => {
        calls++;
        res.send({ n: 1 });
      },
    });
    return { app, store, api, calls: () => calls };
  }

  it('sets a weak ETag on GET 2xx responses by default', async () => {
    const { app } = makeApp();
    const res = makeRes();
    await app.handle(makeReq({ path: '/data' }), res);
    expect(res.headers.ETag).toBe(computeEtag(defaultBody({ n: 1 }), 'weak'));
    // Delegated via sendRaw with the already-serialized body (avoiding a
    // second serializer pass) — see the "reuses the serialized body" test.
    expect(res.rawBody).toBe(defaultBody({ n: 1 }));
  });

  it("etag: 'strong' emits an unprefixed tag", async () => {
    const { app } = makeApp({ etag: 'strong' });
    const res = makeRes();
    await app.handle(makeReq({ path: '/data' }), res);
    expect(res.headers.ETag).toBe(computeEtag(defaultBody({ n: 1 }), 'strong'));
  });

  it('etag: false disables ETag and 304 handling', async () => {
    const { app } = makeApp({ etag: false });
    const res = makeRes();
    await app.handle(
      makeReq({ path: '/data', headers: { 'if-none-match': '*' } }),
      res,
    );
    expect(res.headers.ETag).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.rawBody).toBe(defaultBody({ n: 1 }));
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const { app } = makeApp();
    const first = makeRes();
    await app.handle(makeReq({ path: '/data' }), first);
    const etag = first.headers.ETag;

    const res = makeRes();
    await app.handle(
      makeReq({ path: '/data', headers: { 'if-none-match': etag } }),
      res,
    );
    expect(res.statusCode).toBe(304);
    expect(res.rawBody).toBe('');
    expect(res.sentData).toBeUndefined();
    expect(res.headers.ETag).toBe(etag);
  });

  it('weak-compares: a strong client tag matches the weak server tag', async () => {
    const { app } = makeApp();
    const first = makeRes();
    await app.handle(makeReq({ path: '/data' }), first);
    const strongForm = (first.headers.ETag as string).slice(2); // strip W/

    const res = makeRes();
    await app.handle(
      makeReq({ path: '/data', headers: { 'if-none-match': strongForm } }),
      res,
    );
    expect(res.statusCode).toBe(304);
  });

  it('a matching tag inside a comma list triggers 304', async () => {
    const { app } = makeApp();
    const first = makeRes();
    await app.handle(makeReq({ path: '/data' }), first);

    const res = makeRes();
    await app.handle(
      makeReq({
        path: '/data',
        headers: { 'if-none-match': `"nope", ${first.headers.ETag}` },
      }),
      res,
    );
    expect(res.statusCode).toBe(304);
  });

  it('a non-matching If-None-Match gets the full 200', async () => {
    const { app } = makeApp();
    const res = makeRes();
    await app.handle(
      makeReq({ path: '/data', headers: { 'if-none-match': '"stale-tag"' } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.rawBody).toBe(defaultBody({ n: 1 }));
  });

  it('a 304 skips the cache write', async () => {
    const { app, store } = makeApp({ routes: ['/'] });
    const res = makeRes();
    await app.handle(
      makeReq({ path: '/data', headers: { 'if-none-match': '*' } }),
      res,
    );
    expect(res.statusCode).toBe(304);
    expect(store.size).toBe(0);
  });

  it('applies to HEAD requests too', async () => {
    const { app } = makeApp();
    const res = makeRes();
    await app.handle(makeReq({ method: 'HEAD', path: '/data' }), res);
    expect(res.headers.ETag).toMatch(/^W\//);

    const res304 = makeRes();
    await app.handle(
      makeReq({
        method: 'HEAD',
        path: '/data',
        headers: { 'if-none-match': res.headers.ETag },
      }),
      res304,
    );
    expect(res304.statusCode).toBe(304);
  });

  it('does not tag non-2xx responses', async () => {
    const app = new Axiomify();
    useCache(app, { store: new MemoryCacheStore() });
    app.route({
      method: 'GET',
      path: '/missing',
      handler: async (_req, res) => res.status(404).send(null, 'not here'),
    });
    const res = makeRes();
    await app.handle(makeReq({ path: '/missing' }), res);
    expect(res.headers.ETag).toBeUndefined();
    expect(res.statusCode).toBe(404);
  });

  it('does not touch non-GET/HEAD methods', async () => {
    const app = new Axiomify();
    useCache(app, { store: new MemoryCacheStore() });
    app.route({
      method: 'POST',
      path: '/data',
      handler: async (_req, res) => res.send({ ok: true }),
    });
    const res = makeRes();
    await app.handle(makeReq({ method: 'POST', path: '/data' }), res);
    expect(res.headers.ETag).toBeUndefined();
  });

  it('respects a handler-set ETag and uses it for 304s', async () => {
    const app = new Axiomify();
    useCache(app, { store: new MemoryCacheStore() });
    app.route({
      method: 'GET',
      path: '/custom',
      handler: async (_req, res) => {
        res.header('ETag', '"custom-v1"');
        res.send({ n: 1 });
      },
    });
    const res = makeRes();
    await app.handle(makeReq({ path: '/custom' }), res);
    expect(res.headers.ETag).toBe('"custom-v1"');

    const res304 = makeRes();
    await app.handle(
      makeReq({ path: '/custom', headers: { 'if-none-match': '"custom-v1"' } }),
      res304,
    );
    expect(res304.statusCode).toBe(304);
  });

  it('tags sendRaw() responses over the raw payload', async () => {
    const app = new Axiomify();
    useCache(app, { store: new MemoryCacheStore() });
    app.route({
      method: 'GET',
      path: '/raw',
      handler: async (_req, res) => res.sendRaw('<h1>hi</h1>', 'text/html'),
    });
    const res = makeRes();
    await app.handle(makeReq({ path: '/raw' }), res);
    expect(res.headers.ETag).toBe(computeEtag('<h1>hi</h1>', 'weak'));
    expect(res.rawBody).toBe('<h1>hi</h1>');
    expect(res.rawContentType).toBe('text/html');
  });
});

describe('shared response cache', () => {
  function makeApp(cacheOptions: any = {}) {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    const api = useCache(app, { store, routes: ['/'], ...cacheOptions });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/items',
      handler: async (_req, res) => {
        calls++;
        res.send({ items: [1, 2, 3], call: calls });
      },
    });
    return { app, store, api, calls: () => calls };
  }

  it('MISS then HIT: second request is served from the store', async () => {
    const { app, calls } = makeApp();
    const miss = makeRes();
    await app.handle(makeReq({ path: '/items' }), miss);
    expect(miss.headers['X-Cache']).toBe('MISS');
    expect(calls()).toBe(1);

    const hit = makeRes();
    await app.handle(makeReq({ path: '/items' }), hit);
    expect(hit.headers['X-Cache']).toBe('HIT');
    expect(hit.headers.Age).toBe('0');
    expect(hit.statusCode).toBe(200);
    expect(hit.rawBody).toBe(defaultBody({ items: [1, 2, 3], call: 1 }));
    expect(hit.rawContentType).toBe('application/json');
    expect(calls()).toBe(1); // handler not re-invoked
  });

  it('replays the stored ETag and answers If-None-Match with 304 on a hit', async () => {
    const { app } = makeApp();
    const miss = makeRes();
    await app.handle(makeReq({ path: '/items' }), miss);

    const res = makeRes();
    await app.handle(
      makeReq({ path: '/items', headers: { 'if-none-match': miss.headers.ETag } }),
      res,
    );
    expect(res.statusCode).toBe(304);
    expect(res.headers['X-Cache']).toBe('HIT');
    expect(res.rawBody).toBe('');
  });

  it('normalizes query order into one entry', async () => {
    const { app, calls } = makeApp();
    await app.handle(
      makeReq({ path: '/items', query: { b: '2', a: '1' } }),
      makeRes(),
    );
    const hit = makeRes();
    await app.handle(
      makeReq({ path: '/items', query: { a: '1', b: '2' } }),
      hit,
    );
    expect(hit.headers['X-Cache']).toBe('HIT');
    expect(calls()).toBe(1);
  });

  it('different query values are different entries', async () => {
    const { app, calls } = makeApp();
    await app.handle(makeReq({ path: '/items', query: { a: '1' } }), makeRes());
    const res = makeRes();
    await app.handle(makeReq({ path: '/items', query: { a: '2' } }), res);
    expect(res.headers['X-Cache']).toBe('MISS');
    expect(calls()).toBe(2);
  });

  it('global varyHeaders produce one entry per header value', async () => {
    const { app, calls } = makeApp({ varyHeaders: ['Accept-Language'] });
    await app.handle(
      makeReq({ path: '/items', headers: { 'accept-language': 'en' } }),
      makeRes(),
    );
    const fr = makeRes();
    await app.handle(
      makeReq({ path: '/items', headers: { 'accept-language': 'fr' } }),
      fr,
    );
    expect(fr.headers['X-Cache']).toBe('MISS');
    const en = makeRes();
    await app.handle(
      makeReq({ path: '/items', headers: { 'accept-language': 'en' } }),
      en,
    );
    expect(en.headers['X-Cache']).toBe('HIT');
    expect(calls()).toBe(2);
  });

  it('bypasses the cache for requests with Authorization', async () => {
    const { app, calls } = makeApp();
    const authReq = () =>
      makeReq({ path: '/items', headers: { authorization: 'Bearer t' } });
    const r1 = makeRes();
    await app.handle(authReq(), r1);
    const r2 = makeRes();
    await app.handle(authReq(), r2);
    expect(r1.headers['X-Cache']).toBeUndefined();
    expect(r2.headers['X-Cache']).toBeUndefined();
    expect(calls()).toBe(2);
    // ETag still applies to private responses:
    expect(r1.headers.ETag).toBeDefined();
  });

  it('bypasses the cache for requests with Cookie', async () => {
    const { app, calls } = makeApp();
    await app.handle(
      makeReq({ path: '/items', headers: { cookie: 'sid=1' } }),
      makeRes(),
    );
    const res = makeRes();
    await app.handle(
      makeReq({ path: '/items', headers: { cookie: 'sid=1' } }),
      res,
    );
    expect(res.headers['X-Cache']).toBeUndefined();
    expect(calls()).toBe(2);
  });

  it('cachePrivate: true lifts the credentials bypass', async () => {
    const { app, calls } = makeApp({ cachePrivate: true });
    const authReq = () =>
      makeReq({ path: '/items', headers: { authorization: 'Bearer t' } });
    await app.handle(authReq(), makeRes());
    const res = makeRes();
    await app.handle(authReq(), res);
    expect(res.headers['X-Cache']).toBe('HIT');
    expect(calls()).toBe(1);
  });

  it('never caches responses that set cookies via header()', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    app.route({
      method: 'GET',
      path: '/login-ish',
      handler: async (_req, res) => {
        res.header('Set-Cookie', 'sid=abc');
        res.send({ ok: true });
      },
    });
    await app.handle(makeReq({ path: '/login-ish' }), makeRes());
    expect(store.size).toBe(0);
  });

  it('never caches responses that set cookies via res.cookie()', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    app.route({
      method: 'GET',
      path: '/cookie',
      handler: async (_req, res) => {
        (res as any).cookie('sid', 'abc');
        res.send({ ok: true });
      },
    });
    // Hold the spy directly — the plugin replaces res.cookie with a
    // detection wrapper that delegates to this original.
    const cookieSpy = vi.fn().mockReturnThis();
    const res = makeRes({ cookie: cookieSpy });
    await app.handle(makeReq({ path: '/cookie' }), res);
    expect(cookieSpy).toHaveBeenCalledWith('sid', 'abc', undefined);
    expect(store.size).toBe(0);
  });

  it('never caches a response another plugin has already content-encoded', async () => {
    // Reproduces the registration-order bug: a compression-like plugin that
    // sets Content-Encoding and hands ALREADY-TRANSFORMED bytes to cache's
    // wrapped sendRaw (as would happen if useCache() registered before
    // useCompress()) must never be written to the store — those bytes are
    // unsafe to replay to a future client with a different Accept-Encoding.
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    app.route({
      method: 'GET',
      path: '/compressed',
      handler: async (_req, res) => {
        // Simulates an "outer" compression plugin: sets Content-Encoding,
        // then calls sendRaw with bytes that are no longer the identity
        // representation cache's ETag/entry logic assumes.
        res.header('Content-Encoding', 'gzip');
        res.sendRaw(Buffer.from([0x1f, 0x8b, 0x00]), 'application/json');
      },
    });
    await app.handle(makeReq({ path: '/compressed' }), makeRes());
    expect(store.size).toBe(0);
  });

  it('caches only statuses in cacheableStatuses', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    let errorCalls = 0;
    let notFoundCalls = 0;
    app.route({
      method: 'GET',
      path: '/boom',
      handler: async (_req, res) => {
        errorCalls++;
        res.status(500).send(null, 'error');
      },
    });
    app.route({
      method: 'GET',
      path: '/gone',
      handler: async (_req, res) => {
        notFoundCalls++;
        res.status(404).send(null, 'gone');
      },
    });

    await app.handle(makeReq({ path: '/boom' }), makeRes());
    await app.handle(makeReq({ path: '/boom' }), makeRes());
    expect(errorCalls).toBe(2); // 500 never cached

    await app.handle(makeReq({ path: '/gone' }), makeRes());
    const hit = makeRes();
    await app.handle(makeReq({ path: '/gone' }), hit);
    expect(notFoundCalls).toBe(1); // 404 is cacheable by default
    expect(hit.headers['X-Cache']).toBe('HIT');
    expect(hit.statusCode).toBe(404);
  });

  it('honors a custom cacheableStatuses list', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'], cacheableStatuses: [200] });
    app.route({
      method: 'GET',
      path: '/gone',
      handler: async (_req, res) => res.status(404).send(null, 'gone'),
    });
    await app.handle(makeReq({ path: '/gone' }), makeRes());
    expect(store.size).toBe(0);
  });

  it('noCache preset keeps a response out of the shared cache', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    app.route({
      method: 'GET',
      path: '/volatile',
      plugins: [noCache],
      handler: async (_req, res) => res.send({ t: Date.now() }),
    });
    await app.handle(makeReq({ path: '/volatile' }), makeRes());
    expect(store.size).toBe(0);
  });

  it('Cache-Control: private keeps a response out unless cachePrivate', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'] });
    app.route({
      method: 'GET',
      path: '/profile',
      plugins: [cacheControl({ scope: 'private', maxAge: 60 })],
      handler: async (_req, res) => res.send({ me: true }),
    });
    await app.handle(makeReq({ path: '/profile' }), makeRes());
    expect(store.size).toBe(0);
  });

  it('routes prefixes match on segment boundaries', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/api'] });
    app.route({
      method: 'GET',
      path: '/api/x',
      handler: async (_req, res) => res.send({ a: 1 }),
    });
    app.route({
      method: 'GET',
      path: '/apix',
      handler: async (_req, res) => res.send({ b: 2 }),
    });
    await app.handle(makeReq({ path: '/api/x' }), makeRes());
    await app.handle(makeReq({ path: '/apix' }), makeRes());
    expect(store.size).toBe(1);
  });

  it('serves HEAD hits with headers only', async () => {
    const { app } = makeApp();
    const miss = makeRes();
    await app.handle(makeReq({ method: 'HEAD', path: '/items' }), miss);
    expect(miss.headers['X-Cache']).toBe('MISS');
    expect(miss.rawBody).toBe('');
    expect(miss.headers.ETag).toBeDefined();

    const hit = makeRes();
    await app.handle(makeReq({ method: 'HEAD', path: '/items' }), hit);
    expect(hit.headers['X-Cache']).toBe('HIT');
    expect(hit.rawBody).toBe('');
    expect(hit.headers.ETag).toBeDefined();
  });

  it('bypasses cache when set-cookie header is added case-insensitively', async () => {
    const { app, store } = makeApp();
    app.route({
      path: '/auth-cookie',
      handler: async (_req, res) => {
        res.header('set-cookie', 'session=123');
        return res.send({ ok: true });
      },
    });
    const res1 = makeRes();
    await app.handle(makeReq({ path: '/auth-cookie' }), res1);
    expect(res1.headers['X-Cache']).toBeUndefined();

    const res2 = makeRes();
    await app.handle(makeReq({ path: '/auth-cookie' }), res2);
    expect(res2.headers['X-Cache']).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('fails open when the store throws', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    const broken = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      delete: store.delete.bind(store),
      clear: store.clear.bind(store),
    };
    useCache(app, { store: broken as any, routes: ['/'] });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/items',
      handler: async (_req, res) => {
        calls++;
        res.send({ ok: true });
      },
    });
    const res = makeRes();
    await app.handle(makeReq({ path: '/items' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.rawBody).toBe(defaultBody({ ok: true }));
    expect(calls).toBe(1);
  });
});

describe('cached() route scoping', () => {
  it('opts a route in without global routes prefixes', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store }); // no routes → only cached() routes are stored
    let cachedCalls = 0;
    let plainCalls = 0;
    app.route({
      method: 'GET',
      path: '/cached',
      plugins: [cached({ ttl: 60 })],
      handler: async (_req, res) => {
        cachedCalls++;
        res.send({ c: cachedCalls });
      },
    });
    app.route({
      method: 'GET',
      path: '/plain',
      handler: async (_req, res) => {
        plainCalls++;
        res.send({ p: plainCalls });
      },
    });

    await app.handle(makeReq({ path: '/cached' }), makeRes());
    const hit = makeRes();
    await app.handle(makeReq({ path: '/cached' }), hit);
    expect(hit.headers['X-Cache']).toBe('HIT');
    expect(cachedCalls).toBe(1);

    await app.handle(makeReq({ path: '/plain' }), makeRes());
    await app.handle(makeReq({ path: '/plain' }), makeRes());
    expect(plainCalls).toBe(2);
    expect(store.size).toBe(1);
  });

  it('uses per-route ttl over defaultTtl', async () => {
    vi.useFakeTimers();
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, defaultTtl: 3600 });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/short',
      plugins: [cached({ ttl: 1 })],
      handler: async (_req, res) => {
        calls++;
        res.send({ calls });
      },
    });
    await app.handle(makeReq({ path: '/short' }), makeRes());
    vi.advanceTimersByTime(500);
    const hit = makeRes();
    await app.handle(makeReq({ path: '/short' }), hit);
    expect(hit.headers['X-Cache']).toBe('HIT');
    vi.advanceTimersByTime(600); // past the 1s ttl, no swr
    const miss = makeRes();
    await app.handle(makeReq({ path: '/short' }), miss);
    expect(miss.headers['X-Cache']).toBe('MISS');
    expect(calls).toBe(2);
  });

  it('per-route varyHeaders act as a single-variant secondary key', async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/vary',
      plugins: [cached({ ttl: 60, varyHeaders: ['Accept-Language'] })],
      handler: async (req, res) => {
        calls++;
        res.send({ lang: req.headers['accept-language'] ?? 'none' });
      },
    });
    const en = () =>
      makeReq({ path: '/vary', headers: { 'accept-language': 'en' } });
    const fr = () =>
      makeReq({ path: '/vary', headers: { 'accept-language': 'fr' } });

    await app.handle(en(), makeRes());
    const enHit = makeRes();
    await app.handle(en(), enHit);
    expect(enHit.headers['X-Cache']).toBe('HIT');
    expect(calls).toBe(1);

    // Different vary value → secondary-key mismatch → miss, entry replaced.
    const frMiss = makeRes();
    await app.handle(fr(), frMiss);
    expect(frMiss.headers['X-Cache']).toBe('MISS');
    expect(calls).toBe(2);

    const frHit = makeRes();
    await app.handle(fr(), frHit);
    expect(frHit.headers['X-Cache']).toBe('HIT');
    expect(frHit.rawBody).toBe(defaultBody({ lang: 'fr' }));

    // …and the en variant was displaced (single variant per key).
    const enAgain = makeRes();
    await app.handle(en(), enAgain);
    expect(enAgain.headers['X-Cache']).toBe('MISS');
    expect(calls).toBe(3);
  });
});

describe('stale-while-revalidate', () => {
  async function flushMicrotasks(rounds = 25) {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
  }

  it('serves stale to concurrent requests while exactly one revalidates', async () => {
    vi.useFakeTimers();
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'], defaultTtl: 1, staleWhileRevalidate: 60 });

    let calls = 0;
    let block: Promise<void> | null = null;
    app.route({
      method: 'GET',
      path: '/swr',
      handler: async (_req, res) => {
        calls++;
        if (block) await block;
        res.send({ n: calls });
      },
    });

    // Prime the cache.
    const prime = makeRes();
    await app.handle(makeReq({ path: '/swr' }), prime);
    expect(prime.headers['X-Cache']).toBe('MISS');

    // Enter the stale window (past ttl=1s, within swr=60s).
    vi.advanceTimersByTime(2_000);

    // Request A discovers staleness first: it takes the refresh flag and
    // falls through to the (blocked) handler.
    let release!: () => void;
    block = new Promise<void>((r) => (release = r));
    const resA = makeRes();
    const pA = app.handle(makeReq({ path: '/swr' }), resA);
    await flushMicrotasks();
    expect(calls).toBe(2); // A reached the handler

    // Requests B and C arrive while A holds the refresh flag → stale.
    const resB = makeRes();
    await app.handle(makeReq({ path: '/swr' }), resB);
    expect(resB.headers['X-Cache']).toBe('STALE');
    expect(resB.headers.Age).toBe('2');
    expect(resB.rawBody).toBe(defaultBody({ n: 1 }));

    const resC = makeRes();
    await app.handle(makeReq({ path: '/swr' }), resC);
    expect(resC.headers['X-Cache']).toBe('STALE');
    expect(calls).toBe(2); // still only the one refresher in flight

    // A finishes: fresh response, marked EXPIRED, entry replaced.
    block = null;
    release();
    await pA;
    expect(resA.headers['X-Cache']).toBe('EXPIRED');
    expect(resA.rawBody).toBe(defaultBody({ n: 2 }));

    // Next request is a fresh HIT on the new entry.
    const resD = makeRes();
    await app.handle(makeReq({ path: '/swr' }), resD);
    expect(resD.headers['X-Cache']).toBe('HIT');
    expect(resD.rawBody).toBe(defaultBody({ n: 2 }));
    expect(calls).toBe(2);
  });

  it('past ttl + swr the entry is a plain miss', async () => {
    vi.useFakeTimers();
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'], defaultTtl: 1, staleWhileRevalidate: 2 });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/swr',
      handler: async (_req, res) => {
        calls++;
        res.send({ n: calls });
      },
    });
    await app.handle(makeReq({ path: '/swr' }), makeRes());
    vi.advanceTimersByTime(4_000); // past ttl(1) + swr(2)
    const res = makeRes();
    await app.handle(makeReq({ path: '/swr' }), res);
    expect(res.headers['X-Cache']).toBe('MISS');
    expect(calls).toBe(2);
  });

  it('a crashed refresher releases the claim for the next discoverer', async () => {
    vi.useFakeTimers();
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    useCache(app, { store, routes: ['/'], defaultTtl: 1, staleWhileRevalidate: 60 });
    let fail = false;
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/swr',
      handler: async (_req, res) => {
        calls++;
        if (fail) {
          res.status(500).send(null, 'boom');
          return;
        }
        res.send({ n: calls });
      },
    });
    await app.handle(makeReq({ path: '/swr' }), makeRes());
    vi.advanceTimersByTime(2_000);

    fail = true;
    const resA = makeRes();
    await app.handle(makeReq({ path: '/swr' }), resA);
    expect(resA.statusCode).toBe(500); // refresher failed, 500 not cached

    // The claim was released on send — the next request becomes the refresher
    // instead of being served stale forever.
    fail = false;
    const resB = makeRes();
    await app.handle(makeReq({ path: '/swr' }), resB);
    expect(resB.headers['X-Cache']).toBe('EXPIRED');
    expect(calls).toBe(3);
  });
});

describe('invalidation', () => {
  function makeApp() {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    const api = useCache(app, { store, routes: ['/'] });
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/items',
      handler: async (_req, res) => {
        calls++;
        res.send({ calls });
      },
    });
    return { app, store, api, calls: () => calls };
  }

  it('invalidate() deletes the exact path entry', async () => {
    const { app, api } = makeApp();
    await app.handle(makeReq({ path: '/items' }), makeRes());
    await api.invalidate('/items');
    const res = makeRes();
    await app.handle(makeReq({ path: '/items' }), res);
    expect(res.headers['X-Cache']).toBe('MISS');
  });

  it('invalidate() with a query object targets that variant only', async () => {
    const { app, api } = makeApp();
    await app.handle(makeReq({ path: '/items', query: { a: '1' } }), makeRes());
    await app.handle(makeReq({ path: '/items', query: { a: '2' } }), makeRes());
    await api.invalidate('/items', { query: { a: '1' } });

    const missed = makeRes();
    await app.handle(makeReq({ path: '/items', query: { a: '1' } }), missed);
    expect(missed.headers['X-Cache']).toBe('MISS');

    const hit = makeRes();
    await app.handle(makeReq({ path: '/items', query: { a: '2' } }), hit);
    expect(hit.headers['X-Cache']).toBe('HIT');
  });

  it('invalidatePath() removes every variant for the path', async () => {
    const { app, api, store } = makeApp();
    await app.handle(makeReq({ path: '/items', query: { a: '1' } }), makeRes());
    await app.handle(makeReq({ path: '/items', query: { a: '2' } }), makeRes());
    expect(store.size).toBe(2);
    await api.invalidatePath('/items');
    expect(store.size).toBe(0);
  });

  it('invalidatePath() throws for stores without deleteByPrefix', async () => {
    const app = new Axiomify();
    const bare = {
      get: async () => undefined,
      set: async () => { },
      delete: async () => { },
      clear: async () => { },
    };
    const api = useCache(app, { store: bare });
    await expect(api.invalidatePath('/x')).rejects.toThrow(/deleteByPrefix/);
  });

  it('clear() empties the store', async () => {
    const { app, api, store } = makeApp();
    await app.handle(makeReq({ path: '/items' }), makeRes());
    await api.clear();
    expect(store.size).toBe(0);
  });
});

describe('createCacheModule', () => {
  it("registers the hook and provides the 'cache' DI service", async () => {
    const app = new Axiomify();
    const store = new MemoryCacheStore();
    app.use(createCacheModule({ store, routes: ['/'] }));
    let calls = 0;
    app.route({
      method: 'GET',
      path: '/items',
      handler: async (_req, res) => {
        calls++;
        res.send({ calls });
      },
    });

    await app.handle(makeReq({ path: '/items' }), makeRes());
    const hit = makeRes();
    await app.handle(makeReq({ path: '/items' }), hit);
    expect(hit.headers['X-Cache']).toBe('HIT');

    const cache = app.resolve('cache');
    expect(cache.store).toBe(store);
    await cache.invalidatePath('/items');
    const miss = makeRes();
    await app.handle(makeReq({ path: '/items' }), miss);
    expect(miss.headers['X-Cache']).toBe('MISS');
    expect(calls).toBe(2);
  });

  it('is idempotent by module name', () => {
    const app = new Axiomify();
    const mod = createCacheModule({ store: new MemoryCacheStore() });
    app.use(mod);
    expect(() => app.use(mod)).not.toThrow(); // second use() is a no-op
  });

  it('handles custom stores without lock functions and res.getHeaders() fallback', async () => {
    const map = new Map<string, any>();
    const customStore: any = {
      get: (k: string) => Promise.resolve(map.get(k) ?? null),
      set: (k: string, v: any) => { map.set(k, v); return Promise.resolve(); },
      delete: (k: string) => { map.delete(k); return Promise.resolve(); },
      clear: () => { map.clear(); return Promise.resolve(); },
    };

    const app = new Axiomify();
    app.use(createCacheModule({ store: customStore }));
    app.route({
      method: 'GET',
      path: '/custom',
      handler: async (_req, res: any) => {
        if (typeof res.getHeaders !== 'function') {
          res.getHeaders = () => ({ 'X-Custom-Header': 'value' });
        }
        res.send({ ok: true });
      },
    });

    const res1 = makeRes();
    await app.handle(makeReq({ path: '/custom' }), res1);
    expect(res1.headers['X-Cache']).toBe('MISS');

    const res2 = makeRes();
    await app.handle(makeReq({ path: '/custom' }), res2);
    expect(res2.headers['X-Cache']).toBe('HIT');
  });
});
