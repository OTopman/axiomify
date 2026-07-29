import { afterEach, describe, expect, it, vi } from 'vitest';
import { Axiomify, signCookieValue, unsignCookieValue } from '@axiomify/core';
import { RequestStateImpl } from '@axiomify/core';
import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';
import {
  MemorySessionStore,
  createSessionModule,
  getSession,
  useSession,
} from '../src/index';
import type { Session, SessionOptions, SessionStore } from '../src/index';

const SECRET = 'a'.repeat(32);
const OLD_SECRET = 'b'.repeat(32);
const COOKIE_NAME = 'axiomify.sid';

// ─── Mock req/res (same shape as packages/core/tests/app.extra.test.ts,
//     plus res.cookie/clearCookie capture) ────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}): AxiomifyRequest {
  return {
    id: 'r1',
    method: 'GET',
    url: '/t',
    path: '/t',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  } as unknown as AxiomifyRequest;
}

interface CapturedCookie {
  name: string;
  value: string;
  options: Record<string, unknown> | undefined;
}

type MockRes = AxiomifyResponse & {
  cookies: CapturedCookie[];
  cleared: Array<{ name: string; options: unknown }>;
};

function makeRes(overrides: Record<string, unknown> = {}): MockRes {
  const headers: Record<string, string> = {};
  const cookies: CapturedCookie[] = [];
  const cleared: Array<{ name: string; options: unknown }> = [];
  let sent = false;
  const res: Record<string, unknown> = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn().mockReturnThis(),
    send: vi.fn(() => {
      sent = true;
    }),
    sendRaw: vi.fn(),
    stream: vi.fn(),
    cookie: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
      cookies.push({ name, value, options });
      return res;
    }),
    clearCookie: vi.fn((name: string, options?: unknown) => {
      cleared.push({ name, options });
      return res;
    }),
    get headersSent() {
      return sent;
    },
    statusCode: 200,
    raw: {},
    capabilities: { sse: false, streaming: false },
    cookies,
    cleared,
    ...overrides,
  };
  return res as unknown as MockRes;
}

type Handler = (req: AxiomifyRequest, res: AxiomifyResponse) => void | Promise<void>;

function buildApp(
  opts: Partial<SessionOptions> = {},
  handler?: Handler,
): { app: Axiomify; store: SessionStore } {
  const app = new Axiomify();
  const store = opts.store ?? new MemorySessionStore();
  useSession(app, { secret: SECRET, ...opts, store });
  app.route({
    method: 'GET',
    path: '/t',
    handler:
      handler ??
      (async (req, res) => {
        res.send({ ok: true });
      }),
  });
  return { app, store };
}

/** Extract the raw session id from the last captured session cookie. */
function lastSessionId(res: MockRes): string {
  const sessionCookies = res.cookies.filter((c) => c.name === COOKIE_NAME);
  const last = sessionCookies[sessionCookies.length - 1];
  const unsigned = unsignCookieValue(last.value, [SECRET, OLD_SECRET]);
  expect(unsigned.valid).toBe(true);
  return unsigned.value!;
}

function cookieHeaderFor(res: MockRes): string {
  const sessionCookies = res.cookies.filter((c) => c.name === COOKIE_NAME);
  return `${COOKIE_NAME}=${sessionCookies[sessionCookies.length - 1].value}`;
}

describe('useSession — registration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws when secret is missing', () => {
    expect(() => buildApp({ secret: undefined as unknown as string })).toThrow(
      /`secret` is required/,
    );
    expect(() => buildApp({ secret: [] })).toThrow(/`secret` is required/);
  });

  it('throws when the secret is shorter than 32 bytes', () => {
    expect(() => buildApp({ secret: 'short' })).toThrow(/at least 32 bytes/);
  });

  it('throws when any rotation entry is shorter than 32 bytes', () => {
    expect(() => buildApp({ secret: [SECRET, 'short'] })).toThrow(/at least 32 bytes/);
  });

  it('counts secret length in UTF-8 bytes, not characters', () => {
    // 16 two-byte characters = 32 chars? No — 16 chars, 32 bytes: valid.
    expect(() => buildApp({ secret: 'é'.repeat(16) })).not.toThrow();
    // 20 single-byte chars padded with multi-byte still short of 32 bytes.
    expect(() => buildApp({ secret: 'é'.repeat(15) })).toThrow(/30 bytes/);
  });

  it('rejects invalid cookie names at registration', () => {
    expect(() => buildApp({ cookieName: 'bad name;' })).toThrow(/RFC 6265/);
  });

  it('rejects non-positive idleTimeout and absoluteTimeout', () => {
    expect(() => buildApp({ idleTimeout: 0 })).toThrow(/idleTimeout/);
    expect(() => buildApp({ idleTimeout: -5 })).toThrow(/idleTimeout/);
    expect(() => buildApp({ absoluteTimeout: 0 })).toThrow(/absoluteTimeout/);
  });

  it('provides the store through DI as "sessionStore"', () => {
    const { app, store } = buildApp();
    expect(app.resolve('sessionStore')).toBe(store);
  });

  it('defaults to a MemorySessionStore and warns in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const mod = createSessionModule({ secret: SECRET });
      expect(mod.name).toBe('@axiomify/session');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('MemorySessionStore'));
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('useSession — lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('two-request lifecycle: write on request 1, read back on request 2', async () => {
    const seen: Array<{ id: string; isNew: boolean; userId: unknown }> = [];
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      if (s.isNew) s.userId = 42;
      seen.push({ id: s.id, isNew: s.isNew, userId: s.userId });
      res.send({ ok: true });
    });

    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    expect(seen[0].isNew).toBe(true);
    const id = lastSessionId(res1);
    expect(id).toBe(seen[0].id);
    // 128-bit id → 22-char base64url
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const res2 = makeRes();
    await app.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), res2);
    expect(seen[1]).toEqual({ id, isNew: false, userId: 42 });
    // Read-only second request (no rolling): no new cookie.
    expect(res2.cookies).toHaveLength(0);
  });

  it('reads from the adapter-provided req.cookies instead of re-parsing the header', async () => {
    // Regression: session.ts used to call core's getCookies(req) — which
    // parses req.headers['cookie'] independently — instead of the
    // adapter's own req.cookies, causing a redundant parse whenever both
    // are read in the same request. Proven behaviorally here: the Cookie
    // *header* carries a bogus value while req.cookies carries the real
    // signed cookie directly — the session only loads correctly if the
    // code path actually reads req.cookies.
    const seen: Array<{ id: string; isNew: boolean; userId: unknown }> = [];
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      if (s.isNew) s.userId = 42;
      seen.push({ id: s.id, isNew: s.isNew, userId: s.userId });
      res.send({});
    });

    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    const signedCookie = res1.cookies.find((c) => c.name === COOKIE_NAME)!.value;

    const res2 = makeRes();
    await app.handle(
      makeReq({
        headers: { cookie: `${COOKIE_NAME}=not-a-real-signed-value` },
        cookies: { [COOKIE_NAME]: signedCookie },
      }),
      res2,
    );
    expect(seen[1]).toMatchObject({ id: seen[0].id, isNew: false });
  });

  it('saveUninitialized=false: untouched session → no cookie, no store write', async () => {
    const store = new MemorySessionStore();
    const setSpy = vi.spyOn(store, 'set');
    const { app } = buildApp({ store });
    const res = makeRes();
    await app.handle(makeReq(), res);
    expect(res.cookies).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('saveUninitialized=true: cookie is set eagerly in onRequest and the store is written', async () => {
    const store = new MemorySessionStore();
    let cookiesAtHandlerTime = -1;
    const { app } = buildApp({ store, saveUninitialized: true }, async (req, res) => {
      cookiesAtHandlerTime = (res as MockRes).cookies.length;
      res.send({ ok: true });
    });
    const res = makeRes();
    await app.handle(makeReq(), res);
    expect(cookiesAtHandlerTime).toBe(1); // eager — before the handler ran
    expect(await store.get(lastSessionId(res))).not.toBeNull();
  });

  it('tampered signature → fresh anonymous session', async () => {
    const { app, store } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      s.userId = 'victim';
      res.send({});
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    const realId = lastSessionId(res1);

    const forged = `${COOKIE_NAME}=s:${realId}.AAAAforgedAAAA`;
    const ids: string[] = [];
    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store });
    app2.route({
      method: 'GET',
      path: '/t',
      handler: async (req, res) => {
        const s = getSession(req);
        ids.push(s.id);
        expect(s.isNew).toBe(true);
        expect(s.userId).toBeUndefined();
        res.send({});
      },
    });
    await app2.handle(makeReq({ headers: { cookie: forged } }), makeRes());
    expect(ids[0]).not.toBe(realId);
  });

  it('valid signature but unknown id → fresh session (never reuse client ids)', async () => {
    const signed = signCookieValue('ghost-session-id-000000', SECRET);
    const seen: Session[] = [];
    const { app } = buildApp({}, async (req, res) => {
      seen.push(getSession(req));
      res.send({});
    });
    await app.handle(
      makeReq({ headers: { cookie: `${COOKIE_NAME}=${signed}` } }),
      makeRes(),
    );
    expect(seen[0].isNew).toBe(true);
    expect(seen[0].id).not.toBe('ghost-session-id-000000');
  });

  it('malformed store record → fresh session', async () => {
    const store = new MemorySessionStore();
    vi.spyOn(store, 'get').mockResolvedValue({ garbage: true } as never);
    const seen: Session[] = [];
    const { app } = buildApp({ store }, async (req, res) => {
      seen.push(getSession(req));
      res.send({});
    });
    const cookie = `${COOKIE_NAME}=${signCookieValue('whatever-id', SECRET)}`;
    await app.handle(makeReq({ headers: { cookie } }), makeRes());
    expect(seen[0].isNew).toBe(true);
  });

  it('secret rotation: cookie signed with an old secret is accepted and re-signed with the primary', async () => {
    const store = new MemorySessionStore();
    await store.set('rotated-id', { data: { userId: 9 }, createdAt: Date.now() }, 3600);
    const oldCookie = `${COOKIE_NAME}=${signCookieValue('rotated-id', OLD_SECRET)}`;

    const { app } = buildApp({ store, secret: [SECRET, OLD_SECRET] }, async (req, res) => {
      const s = getSession(req);
      expect(s.isNew).toBe(false);
      expect(s.userId).toBe(9);
      s.lastSeen = 'now'; // dirty → cookie re-issued
      res.send({});
    });
    const res = makeRes();
    await app.handle(makeReq({ headers: { cookie: oldCookie } }), res);
    const reSigned = res.cookies.find((c) => c.name === COOKIE_NAME)!;
    // Verifies against the NEW primary secret alone.
    expect(unsignCookieValue(reSigned.value, SECRET).valid).toBe(true);
    expect(unsignCookieValue(reSigned.value, SECRET).value).toBe('rotated-id');
  });

  it('rolling=true: read-only request re-issues the cookie and slides the store TTL', async () => {
    const store = new MemorySessionStore();
    const touchSpy = vi.spyOn(store, 'touch');
    const { app } = buildApp({ store, rolling: true, idleTimeout: 300 }, async (req, res) => {
      getSession(req).userId = 1;
      res.send({});
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);

    // Second request: reads only.
    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store, rolling: true, idleTimeout: 300 });
    app2.route({
      method: 'GET',
      path: '/t',
      handler: async (_req, res) => res.send({}),
    });
    const res2 = makeRes();
    await app2.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), res2);
    expect(res2.cookies.filter((c) => c.name === COOKIE_NAME)).toHaveLength(1);
    expect(touchSpy).toHaveBeenCalledWith(lastSessionId(res1), 300);
  });

  it('rolling=false: read-only request neither re-issues the cookie nor touches the store', async () => {
    const store = new MemorySessionStore();
    const touchSpy = vi.spyOn(store, 'touch');
    const { app } = buildApp({ store }, async (req, res) => {
      getSession(req).userId = 1;
      res.send({});
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    touchSpy.mockClear();

    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store });
    app2.route({ method: 'GET', path: '/t', handler: async (_r, res) => res.send({}) });
    const res2 = makeRes();
    await app2.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), res2);
    expect(res2.cookies).toHaveLength(0);
    expect(touchSpy).not.toHaveBeenCalled();
  });

  it('idle TTL expiry: an expired session yields a fresh one', async () => {
    vi.useFakeTimers();
    const store = new MemorySessionStore();
    const { app } = buildApp({ store, idleTimeout: 60 }, async (req, res) => {
      const s = getSession(req);
      if (s.isNew) s.userId = 5;
      res.send({ isNew: s.isNew });
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);

    vi.advanceTimersByTime(61_000);
    const seen: Session[] = [];
    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store, idleTimeout: 60 });
    app2.route({
      method: 'GET',
      path: '/t',
      handler: async (req, res) => {
        seen.push(getSession(req));
        res.send({});
      },
    });
    await app2.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), makeRes());
    expect(seen[0].isNew).toBe(true);
    expect(seen[0].userId).toBeUndefined();
  });

  it('absoluteTimeout: session is discarded (and destroyed) once its total age is exceeded', async () => {
    const store = new MemorySessionStore();
    const destroySpy = vi.spyOn(store, 'destroy');
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    await store.set('old-one', { data: { userId: 3 }, createdAt: twoHoursAgo }, 86_400);

    const seen: Session[] = [];
    const { app } = buildApp({ store, absoluteTimeout: 3600 }, async (req, res) => {
      seen.push(getSession(req));
      res.send({});
    });
    const cookie = `${COOKIE_NAME}=${signCookieValue('old-one', SECRET)}`;
    await app.handle(makeReq({ headers: { cookie } }), makeRes());
    expect(seen[0].isNew).toBe(true);
    expect(destroySpy).toHaveBeenCalledWith('old-one');
    expect(await store.get('old-one')).toBeNull();
  });
});

describe('session object API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('destroy(): removes the store entry, expires the cookie, blocks further writes', async () => {
    const store = new MemorySessionStore();
    const { app } = buildApp({ store }, async (req, res) => {
      getSession(req).userId = 1;
      res.send({});
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    const id = lastSessionId(res1);
    expect(await store.get(id)).not.toBeNull();

    let destroyedSession: Session | undefined;
    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store });
    app2.route({
      method: 'GET',
      path: '/t',
      handler: async (req, res) => {
        const s = getSession(req);
        await s.destroy();
        destroyedSession = s;
        res.send({});
      },
    });
    const res2 = makeRes();
    await app2.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), res2);
    expect(await store.get(id)).toBeNull();
    expect(res2.cleared).toContainEqual({
      name: COOKIE_NAME,
      options: expect.objectContaining({ path: '/' }),
    });
    expect(() => {
      destroyedSession!.userId = 2;
    }).toThrow(/destroyed/);
  });

  it('destroyed session is not re-persisted at end of request', async () => {
    const store = new MemorySessionStore();
    const setSpy = vi.spyOn(store, 'set');
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      s.userId = 1; // dirty…
      await s.destroy(); // …then destroyed
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('regenerate(): new id, data kept, old store entry destroyed, new cookie emitted', async () => {
    const store = new MemorySessionStore();
    const { app } = buildApp({ store }, async (req, res) => {
      getSession(req).userId = 7;
      res.send({});
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    const oldId = lastSessionId(res1);

    let newId = '';
    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store });
    app2.route({
      method: 'GET',
      path: '/t',
      handler: async (req, res) => {
        const s = getSession(req);
        await s.regenerate();
        newId = s.id;
        expect(s.userId).toBe(7); // data survives
        res.send({});
      },
    });
    const res2 = makeRes();
    await app2.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), res2);

    expect(newId).not.toBe(oldId);
    expect(lastSessionId(res2)).toBe(newId); // cookie updated before send
    expect(await store.get(oldId)).toBeNull();
    expect((await store.get(newId))?.data).toEqual({ userId: 7 });
  });

  it('regenerate()/save() on a destroyed session throw', async () => {
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      await s.destroy();
      await expect(s.regenerate()).rejects.toThrow(/destroyed/);
      await expect(s.save()).rejects.toThrow(/destroyed/);
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
  });

  it('touch(): slides the store TTL without a data write', async () => {
    const store = new MemorySessionStore();
    const { app } = buildApp({ store, idleTimeout: 120 }, async (req, res) => {
      getSession(req).userId = 1;
      res.send({});
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);

    const touchSpy = vi.spyOn(store, 'touch');
    const setSpy = vi.spyOn(store, 'set');
    const app2 = new Axiomify();
    useSession(app2, { secret: SECRET, store, idleTimeout: 120 });
    app2.route({
      method: 'GET',
      path: '/t',
      handler: async (req, res) => {
        getSession(req).touch();
        res.send({});
      },
    });
    await app2.handle(makeReq({ headers: { cookie: cookieHeaderFor(res1) } }), makeRes());
    expect(touchSpy).toHaveBeenCalledWith(lastSessionId(res1), 120);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('save(): persists immediately, before the response is sent', async () => {
    const store = new MemorySessionStore();
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      s.cart = ['item-1'];
      await s.save();
      expect((await store.get(s.id))?.data).toEqual({ cart: ['item-1'] });
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect.assertions(1);
  });

  it('save() marks the session clean — no second write at end of request', async () => {
    const store = new MemorySessionStore();
    const setSpy = vi.spyOn(store, 'set');
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      s.a = 1;
      await s.save();
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('reserved keys cannot be assigned', async () => {
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      for (const key of ['id', 'isNew', 'destroy', 'regenerate', 'touch', 'save']) {
        expect(() => {
          (s as Record<string, unknown>)[key] = 'x';
        }).toThrow(/reserved/);
      }
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect.assertions(6);
  });

  it('supports delete, the in operator, Object.keys and toJSON', async () => {
    const store = new MemorySessionStore();
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      s.a = 1;
      s.b = 2;
      delete s.a;
      expect('b' in s).toBe(true);
      expect('a' in s).toBe(false);
      expect('destroy' in s).toBe(true);
      expect(Object.keys(s)).toEqual(['b']);
      expect(JSON.stringify(s)).toBe('{"b":2}');
      res.send({});
    });
    const res = makeRes();
    await app.handle(makeReq(), res);
    expect((await store.get(lastSessionId(res)))?.data).toEqual({ b: 2 });
  });

  it('getSession() throws when the plugin is not registered', async () => {
    const app = new Axiomify();
    let error: Error | undefined;
    app.route({
      method: 'GET',
      path: '/t',
      handler: async (req, res) => {
        try {
          getSession(req);
        } catch (e) {
          error = e as Error;
        }
        res.send({});
      },
    });
    await app.handle(makeReq(), makeRes());
    expect(error?.message).toMatch(/useSession/);
  });

  it('stores the session in req.state under a write-once key (RequestStateImpl)', async () => {
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      s.userId = 1; // property mutation on the stored object still works
      expect(() => (req.state as RequestStateImpl).set('session', {})).toThrow(/immutable/);
      res.send({});
    });
    await app.handle(makeReq({ state: new RequestStateImpl() }), makeRes());
    expect.assertions(1);
  });
});

describe('dirty tracking', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not write the store when the session is only read', async () => {
    const store = new MemorySessionStore();
    await store.set('sid-read', { data: { userId: 1 }, createdAt: Date.now() }, 3600);
    const setSpy = vi.spyOn(store, 'set');
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      void s.userId; // read only
      res.send({});
    });
    const cookie = `${COOKIE_NAME}=${signCookieValue('sid-read', SECRET)}`;
    await app.handle(makeReq({ headers: { cookie } }), makeRes());
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('tracks nested object mutation (session.user.name = …)', async () => {
    const store = new MemorySessionStore();
    await store.set(
      'sid-nested',
      { data: { user: { name: 'ada', tags: ['x'] } }, createdAt: Date.now() },
      3600,
    );
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      (s.user as { name: string }).name = 'grace'; // nested write — no top-level assignment
      res.send({});
    });
    const cookie = `${COOKIE_NAME}=${signCookieValue('sid-nested', SECRET)}`;
    await app.handle(makeReq({ headers: { cookie } }), makeRes());
    expect((await store.get('sid-nested'))?.data).toEqual({
      user: { name: 'grace', tags: ['x'] },
    });
  });

  it('tracks nested array mutation (push)', async () => {
    const store = new MemorySessionStore();
    await store.set('sid-arr', { data: { cart: ['a'] }, createdAt: Date.now() }, 3600);
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      (s.cart as string[]).push('b');
      res.send({});
    });
    const cookie = `${COOKIE_NAME}=${signCookieValue('sid-arr', SECRET)}`;
    await app.handle(makeReq({ headers: { cookie } }), makeRes());
    expect((await store.get('sid-arr'))?.data).toEqual({ cart: ['a', 'b'] });
  });

  it('nested reads are identity-stable and round-trip raw data on assignment', async () => {
    const store = new MemorySessionStore();
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      s.a = { deep: { n: 1 } };
      expect(s.a).toBe(s.a); // cached proxy
      s.b = s.a; // assigning a tracked value must store the raw object
      res.send({});
    });
    const res = makeRes();
    await app.handle(makeReq(), res);
    const persisted = (await store.get(lastSessionId(res)))?.data;
    expect(persisted).toEqual({ a: { deep: { n: 1 } }, b: { deep: { n: 1 } } });
    // Raw data survives structuredClone — proves no Proxy leaked into the store.
    expect(() => structuredClone(persisted)).not.toThrow();
  });

  it('nested writes on a destroyed session throw; nested deletes are ignored', async () => {
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      s.user = { name: 'ada' };
      const user = s.user as { name?: string };
      await s.destroy();
      expect(() => {
        user.name = 'x';
      }).toThrow(/destroyed/);
      expect(() => {
        delete user.name;
      }).not.toThrow();
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect.assertions(2);
  });
});

describe('eager cookie semantics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('queues the Set-Cookie at the moment of the first write, before send()', async () => {
    const { app } = buildApp({}, async (req, res) => {
      const mock = res as MockRes;
      expect(mock.cookies).toHaveLength(0); // lazy: nothing before the write
      getSession(req).userId = 1;
      expect(mock.cookies).toHaveLength(1); // eager: queued synchronously on write
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect.assertions(2);
  });

  it('writes after send(): data persists, cookie is dropped with a single warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemorySessionStore();
    const ids: string[] = [];
    const { app } = buildApp({ store }, async (req, res) => {
      const s = getSession(req);
      res.send({});
      s.late = true; // response already flushed
      ids.push(s.id);
    });
    const res1 = makeRes();
    await app.handle(makeReq(), res1);
    expect(res1.cookies).toHaveLength(0); // cookie could not be delivered
    expect((await store.get(ids[0]))?.data).toEqual({ late: true }); // data still saved
    expect(warn).toHaveBeenCalledTimes(1);

    await app.handle(makeReq(), makeRes());
    // Regression: the dedup flag is scoped to the SESSION INSTANCE (fresh
    // per request), not to the shared plugin context (process-lifetime).
    // A recurring bug must keep warning on every affected request — the
    // previous "warned once per registration, ever" behavior would make an
    // ongoing production session-loss bug invisible after its first hit.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('warns at most once per request even with multiple late writes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      res.send({});
      s.a = 1; // both writes are "late" within this SAME request
      s.b = 2;
    });
    await app.handle(makeReq(), makeRes());
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('secure: "auto"', () => {
  afterEach(() => vi.restoreAllMocks());

  function secureApp() {
    return buildApp(
      { saveUninitialized: true, cookie: { secure: 'auto' } },
      async (_req, res) => res.send({}),
    );
  }

  it('sets Secure when x-forwarded-proto is https', async () => {
    const { app } = secureApp();
    const res = makeRes();
    await app.handle(makeReq({ headers: { 'x-forwarded-proto': 'https' } }), res);
    expect(res.cookies[0].options).toMatchObject({ secure: true });
  });

  it('uses the first hop of a comma-separated x-forwarded-proto', async () => {
    const { app } = secureApp();
    const res = makeRes();
    await app.handle(makeReq({ headers: { 'x-forwarded-proto': 'https, http' } }), res);
    expect(res.cookies[0].options).toMatchObject({ secure: true });
  });

  it('handles array-valued x-forwarded-proto headers', async () => {
    const { app } = secureApp();
    const res = makeRes();
    await app.handle(makeReq({ headers: { 'x-forwarded-proto': ['https'] } }), res);
    expect(res.cookies[0].options).toMatchObject({ secure: true });
  });

  it('omits Secure over plain http', async () => {
    const { app } = secureApp();
    const res = makeRes();
    await app.handle(makeReq(), res);
    expect(res.cookies[0].options).toMatchObject({ secure: false });
  });

  it('passes an explicit secure boolean through unchanged', async () => {
    const { app } = buildApp(
      { saveUninitialized: true, cookie: { secure: true, maxAge: 60 } },
      async (_req, res) => res.send({}),
    );
    const res = makeRes();
    await app.handle(makeReq(), res);
    expect(res.cookies[0].options).toMatchObject({ secure: true, maxAge: 60 });
  });
});

describe('error-path persistence', () => {
  afterEach(() => vi.restoreAllMocks());

  it('persists session data when the handler throws (onClose safety net)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemorySessionStore();
    const setSpy = vi.spyOn(store, 'set');
    const ids: string[] = [];
    const { app } = buildApp({ store }, async (req, _res) => {
      const s = getSession(req);
      s.attempts = 3;
      ids.push(s.id);
      throw new Error('boom');
    });
    const res = makeRes();
    await app.handle(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    // Cookie was queued eagerly at write time, before the throw.
    expect(res.cookies.filter((c) => c.name === COOKIE_NAME)).toHaveLength(1);
    expect((await store.get(ids[0]))?.data).toEqual({ attempts: 3 });
    expect(setSpy).toHaveBeenCalledTimes(1); // onClose saved exactly once
  });

  it('does not double-save on the happy path (onPostHandler + onClose)', async () => {
    const store = new MemorySessionStore();
    const setSpy = vi.spyOn(store, 'set');
    const { app } = buildApp({ store }, async (req, res) => {
      getSession(req).userId = 1;
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the store is down: 500, not a silent fresh session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemorySessionStore();
    vi.spyOn(store, 'get').mockRejectedValue(new Error('redis down'));
    const handler = vi.fn(async (_req: AxiomifyRequest, res: AxiomifyResponse) =>
      res.send({}),
    );
    const { app } = buildApp({ store }, handler);
    const cookie = `${COOKIE_NAME}=${signCookieValue('any-id', SECRET)}`;
    const res = makeRes();
    await app.handle(makeReq({ headers: { cookie } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles delete on nested tracked object proxy and getOwnPropertyDescriptor on missing keys', async () => {
    const { app } = buildApp({}, async (req, res) => {
      const s = getSession(req);
      s.user = { role: 'admin', age: 30 };
      const user = s.user as Record<string, unknown>;
      delete user.age;
      expect(user.age).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(s, 'nonExistentKey')).toBeUndefined();
      res.send({});
    });
    await app.handle(makeReq(), makeRes());
  });
});
