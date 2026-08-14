import {
  AxiomifyError,
  clearCookie,
  getCookies,
  setCookie,
  signCookieValue,
  unsignCookieValue,
} from '@axiomify/core';
import type {
  AppModule,
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  CookieOptions,
} from '@axiomify/core';
import { randomBytes } from 'node:crypto';
import { MemorySessionStore } from './stores';
import type { SessionRecord, SessionStore } from './stores';

// DI type registration — `context.resolve('sessionStore')` is fully typed
// for consumers that import this package (see AppServices in core/types.ts).
declare module '@axiomify/core' {
  interface AppServices {
    sessionStore: SessionStore;
  }
}

/**
 * Cookie options for the session cookie. Identical to core's CookieOptions
 * except `secure` additionally accepts `'auto'`: the Secure flag is set
 * per-request when `x-forwarded-proto` resolves to `https`.
 *
 * ⚠️ `'auto'` trusts the `x-forwarded-proto` header. Only use it behind a
 * proxy/load balancer that strips or overwrites the header on ingress —
 * a client talking directly to Node can forge it and receive the session
 * cookie without the Secure flag.
 */
export type SessionCookieOptions = Omit<CookieOptions, 'secure'> & {
  secure?: boolean | 'auto';
};

export interface SessionOptions {
  /**
   * HMAC-SHA256 signing secret(s). An array enables zero-downtime rotation:
   * cookies are signed with `secret[0]` and verified against all entries.
   * Every entry must be at least 32 bytes of UTF-8 (256 bits) — same rule
   * @axiomify/auth enforces for HS256. Throws at registration otherwise.
   */
  secret: string | string[];
  /** Cookie name. Default: `axiomify.sid`. */
  cookieName?: string;
  /**
   * Session cookie attributes. Defaults (via core's serializeCookie):
   * `HttpOnly; SameSite=Lax; Path=/`. Omit `maxAge` for a browser-session
   * cookie.
   */
  cookie?: SessionCookieOptions;
  /** Storage backend. Default: a fresh `MemorySessionStore`. */
  store?: SessionStore;
  /**
   * Re-issue the cookie and slide the store TTL on every request, keeping
   * active users signed in indefinitely (bounded by `absoluteTimeout`).
   * Default: false.
   */
  rolling?: boolean;
  /**
   * Persist brand-new sessions that were never written to. Default: false —
   * untouched anonymous sessions produce no store write and no Set-Cookie.
   */
  saveUninitialized?: boolean;
  /**
   * Idle timeout in seconds — the store TTL. A session not seen for this
   * long expires. Default: `cookie.maxAge`, else 86 400 (1 day).
   */
  idleTimeout?: number;
  /**
   * Absolute timeout in seconds, measured from session creation. Once
   * exceeded the session is discarded even if the client stayed active
   * (limits the value of a stolen cookie under rolling expiry). Optional.
   */
  absoluteTimeout?: number;
}

/**
 * The per-request session facade. Arbitrary properties are session data;
 * writes are tracked for automatic persistence.
 *
 * `id`, `isNew`, `destroy`, `regenerate`, `touch` and `save` are reserved
 * names — assigning to them throws.
 */
export interface Session {
  readonly id: string;
  readonly isNew: boolean;
  /** Delete the store entry, expire the cookie and freeze the session. */
  destroy(): Promise<void>;
  /** Issue a new session ID (fixation defence) while keeping the data. */
  regenerate(): Promise<void>;
  /** Mark the session for a TTL refresh without changing data. */
  touch(): void;
  /** Persist immediately instead of waiting for the end of the request. */
  save(): Promise<void>;
  [key: string]: unknown;
}

const RESERVED_KEYS = new Set([
  'id',
  'isNew',
  'destroy',
  'regenerate',
  'touch',
  'save',
]);

// Same RFC 6265 token rule core's serializeCookie enforces — validated at
// registration so a bad cookieName fails at boot, not on the first response.
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const kInternal = Symbol('axiomify.session.internal');
const kRaw = Symbol('axiomify.session.raw');

/** 128-bit cryptographically random session ID (22-char base64url). */
function newSessionId(): string {
  return randomBytes(16).toString('base64url');
}

function isHttpsForwarded(req: AxiomifyRequest): boolean {
  let proto = req.headers['x-forwarded-proto'];
  if (Array.isArray(proto)) proto = proto[0];
  if (typeof proto !== 'string') return false;
  // Multiple proxies append comma-separated values; the first is the
  // client-facing hop.
  return proto.split(',')[0].trim().toLowerCase() === 'https';
}

/** Resolved, validated plugin configuration shared by all hooks. */
interface SessionPluginContext {
  cookieName: string;
  secrets: string[];
  cookie: SessionCookieOptions;
  store: SessionStore;
  rolling: boolean;
  saveUninitialized: boolean;
  idleTtl: number;
  absoluteTimeout?: number;
}

class SessionInternal {
  public dirty = false;
  public touched = false;
  public destroyed = false;
  public persisted = false;
  public cookieSet = false;
  /**
   * Identity-stable cache of nested tracking proxies, keyed per session so
   * a data object shared between two requests can never mark the wrong
   * request dirty.
   */
  public readonly tracked = new WeakMap<object, unknown>();
  /**
   * Per-REQUEST dedup for the "modified after headers sent" warning — not
   * per-app. This flag used to live on the shared plugin context, so the
   * very first occurrence anywhere silenced every future occurrence across
   * every subsequent request for the lifetime of the process. Scoping it to
   * this Session instance still dedups repeat `markDirty()` calls within a
   * single request, but a fresh instance (and a fresh warning) is created
   * for the next one.
   */
  private warnedHeadersSent = false;

  constructor(
    private readonly ctx: SessionPluginContext,
    private readonly req: AxiomifyRequest,
    private readonly res: AxiomifyResponse,
    public id: string,
    public isNew: boolean,
    public data: Record<string, unknown>,
    public createdAt: number,
  ) {}

  public resolveCookieOptions(): CookieOptions {
    const { secure, ...rest } = this.ctx.cookie;
    // Path must be explicit (not left to serializeCookie's default): the
    // clear-cookie emitted by destroy() only removes the browser cookie when
    // its Path matches the one the session cookie was set with.
    const resolved: CookieOptions = { path: '/', ...rest };
    if (secure === 'auto') {
      resolved.secure = isHttpsForwarded(this.req);
    } else if (secure !== undefined) {
      resolved.secure = secure;
    }
    return resolved;
  }

  /**
   * Emit the Set-Cookie header now. Headers must still be writable — by
   * onPostHandler the response is usually already flushed, which is exactly
   * why the plugin sets cookies eagerly during onRequest / at first write.
   */
  public setCookieNow(): void {
    if (this.res.headersSent) {
      if (!this.warnedHeadersSent) {
        this.warnedHeadersSent = true;
        console.warn(
          '[axiomify/session] Session was modified after the response was ' +
            'sent — the session cookie could not be delivered to the client ' +
            'and the session will be orphaned. Write to the session (or call ' +
            'save()/regenerate()) before res.send().',
        );
      }
      return;
    }
    setCookie(
      this.res,
      this.ctx.cookieName,
      signCookieValue(this.id, this.ctx.secrets[0]),
      this.resolveCookieOptions(),
    );
    this.cookieSet = true;
  }

  /** First write wins the lazy cookie; later writes just re-flag dirty. */
  public markDirty(): void {
    this.dirty = true;
    this.persisted = false;
    if (!this.cookieSet) this.setCookieNow();
  }

  /**
   * End-of-request persistence. Runs from onPostHandler on the happy path
   * and from onClose as the safety net (handler errors and 404s bypass
   * onPostHandler entirely — see dispatcher.ts). The `persisted` flag is
   * flipped BEFORE the store write so the two hooks can never double-save.
   */
  public async persist(): Promise<void> {
    if (this.destroyed || this.persisted) return;
    this.persisted = true;

    if (this.dirty || (this.isNew && this.ctx.saveUninitialized)) {
      await this.ctx.store.set(
        this.id,
        { data: this.data, createdAt: this.createdAt },
        this.ctx.idleTtl,
      );
      this.dirty = false;
      this.isNew = false;
    } else if (!this.isNew && (this.touched || this.ctx.rolling)) {
      await this.ctx.store.touch(this.id, this.ctx.idleTtl);
      this.touched = false;
    }
    // isNew && !dirty && !saveUninitialized: nothing to do — the store is
    // never written and (thanks to the lazy cookie) no cookie was sent.
  }

  public async destroySession(): Promise<void> {
    this.destroyed = true;
    this.data = {};
    await this.ctx.store.destroy(this.id);
    if (!this.res.headersSent) {
      const { domain, path, secure, sameSite } = this.resolveCookieOptions();
      clearCookie(this.res, this.ctx.cookieName, {
        domain,
        path,
        secure,
        sameSite,
      });
    }
  }

  public async regenerateSession(): Promise<void> {
    if (this.destroyed) {
      throw new AxiomifyError(
        '[axiomify/session] Cannot regenerate a destroyed session.',
      );
    }
    const oldId = this.id;
    const wasNew = this.isNew;
    this.id = newSessionId();
    this.createdAt = Date.now();
    this.dirty = true;
    this.persisted = false;
    // Force a fresh Set-Cookie with the new ID, even if one was already
    // queued for the old ID this request (later Set-Cookie wins per RFC 6265).
    this.cookieSet = false;
    this.setCookieNow();
    if (!wasNew) await this.ctx.store.destroy(oldId);
  }

  public touchSession(): void {
    if (this.destroyed) return;
    this.touched = true;
    this.persisted = false;
    // Refresh the browser-side expiry too (relevant when maxAge is set).
    if (!this.cookieSet) this.setCookieNow();
  }

  public async saveNow(): Promise<void> {
    if (this.destroyed) {
      throw new AxiomifyError(
        '[axiomify/session] Cannot save a destroyed session.',
      );
    }
    if (!this.cookieSet) this.setCookieNow();
    await this.ctx.store.set(
      this.id,
      { data: this.data, createdAt: this.createdAt },
      this.ctx.idleTtl,
    );
    this.dirty = false;
    this.touched = false;
    this.persisted = true;
    this.isNew = false;
  }
}

/** Plain objects and arrays get wrapped in tracking proxies; anything else
 * (Date, Map, Buffer, class instances) is returned as-is — see the
 * createSessionProxy doc for the resulting caveat. */
function isTrackable(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Unwrap a tracking proxy back to its raw target (identity for the rest). */
function unwrapTracked(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const raw = (value as Record<symbol, unknown>)[kRaw];
    if (raw !== undefined) return raw;
  }
  return value;
}

/**
 * Recursively wrap nested plain objects/arrays so deep mutations
 * (`session.user.name = 'x'`, `session.items.push(y)`) also flip the dirty
 * flag. Proxies are cached per session (WeakMap) so `session.a === session.a`
 * and re-reads cost one lookup.
 */
function trackNested(internal: SessionInternal, value: unknown): unknown {
  if (!isTrackable(value)) return value;
  let proxy = internal.tracked.get(value);
  if (!proxy) {
    proxy = new Proxy(value, {
      get(target, prop, receiver) {
        if (prop === kRaw) return target;
        return trackNested(internal, Reflect.get(target, prop, receiver));
      },
      set(target, prop, v) {
        if (internal.destroyed) {
          throw new AxiomifyError(
            '[axiomify/session] Session has been destroyed; writes are no longer allowed.',
          );
        }
        const ok = Reflect.set(target, prop, unwrapTracked(v));
        if (ok) internal.markDirty();
        return ok;
      },
      deleteProperty(target, prop) {
        if (internal.destroyed) return true;
        const ok = Reflect.deleteProperty(target, prop);
        if (ok) internal.markDirty();
        return ok;
      },
    });
    internal.tracked.set(value, proxy);
  }
  return proxy;
}

/**
 * Wrap the session internals in a Proxy so plain property assignment
 * (`session.userId = 42`) is tracked.
 *
 * Why a Proxy instead of a snapshot-compare at the end of the request?
 *  1. Timing — the lazy Set-Cookie decision must be made at the moment of
 *     the FIRST write, while response headers are still open. A snapshot
 *     diff only learns "something changed" after the handler returns, when
 *     the response has typically already been flushed.
 *  2. Cost — snapshot comparison pays a deep clone + deep equal on every
 *     request including the read-only ones; the Proxy costs one trap per
 *     property access and nothing when the session is untouched.
 *
 * Nested mutation IS tracked: reads of plain objects/arrays return
 * recursive tracking proxies (see trackNested), so `session.user.name = 'x'`
 * marks the session dirty. Caveat: non-plain values (Date, Map, Buffer,
 * class instances) are returned raw — mutating those in place is invisible;
 * reassign the key or call `session.touch()` / `await session.save()`.
 */
function createSessionProxy(internal: SessionInternal): Session {
  const methods: Record<string, unknown> = {
    destroy: () => internal.destroySession(),
    regenerate: () => internal.regenerateSession(),
    touch: () => internal.touchSession(),
    save: () => internal.saveNow(),
  };

  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === kInternal) return internal;
      if (prop === 'id') return internal.id;
      if (prop === 'isNew') return internal.isNew;
      if (prop === 'toJSON') return () => ({ ...internal.data });
      if (typeof prop !== 'string') return undefined;
      if (prop in methods) return methods[prop];
      return trackNested(internal, internal.data[prop]);
    },
    set(_target, prop, value) {
      if (typeof prop !== 'string' || RESERVED_KEYS.has(prop)) {
        throw new AxiomifyError(
          `[axiomify/session] Session key "${String(prop)}" is reserved and cannot be assigned.`,
        );
      }
      if (internal.destroyed) {
        throw new AxiomifyError(
          '[axiomify/session] Session has been destroyed; writes are no longer allowed.',
        );
      }
      internal.data[prop] = unwrapTracked(value);
      internal.markDirty();
      return true;
    },
    deleteProperty(_target, prop) {
      if (typeof prop !== 'string' || RESERVED_KEYS.has(prop)) return false;
      if (internal.destroyed) return true;
      if (prop in internal.data) {
        delete internal.data[prop];
        internal.markDirty();
      }
      return true;
    },
    has(_target, prop) {
      return (
        typeof prop === 'string' &&
        (RESERVED_KEYS.has(prop) || prop in internal.data)
      );
    },
    ownKeys() {
      return Reflect.ownKeys(internal.data);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && prop in internal.data) {
        return {
          enumerable: true,
          configurable: true,
          writable: true,
          value: internal.data[prop],
        };
      }
      return undefined;
    },
  }) as Session;
}

function validateSecrets(secret: string | string[] | undefined): string[] {
  const list =
    secret === undefined || secret === null
      ? []
      : Array.isArray(secret)
        ? secret
        : [secret];
  if (list.length === 0) {
    throw new AxiomifyError(
      '[axiomify/session] `secret` is required — a string or a string[] ' +
        '(rotation: sign with the first, verify against all).',
    );
  }
  for (const s of list) {
    const byteLength = typeof s === 'string' ? Buffer.byteLength(s, 'utf8') : 0;
    if (byteLength < 32) {
      throw new AxiomifyError(
        `[axiomify/session] Session secret is ${byteLength} bytes; at least ` +
          '32 bytes (256 bits) are required for HMAC-SHA256 signing. ' +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\"",
      );
    }
  }
  return list;
}

function buildPluginContext(options: SessionOptions): SessionPluginContext {
  const secrets = validateSecrets(options.secret);

  const cookieName = options.cookieName ?? 'axiomify.sid';
  if (!COOKIE_NAME_PATTERN.test(cookieName)) {
    throw new AxiomifyError(
      `[axiomify/session] Invalid cookieName "${cookieName}". Cookie names must be RFC 6265 tokens.`,
    );
  }

  const cookie = options.cookie ?? {};
  const idleTtl = options.idleTimeout ?? cookie.maxAge ?? 86_400;
  if (!Number.isFinite(idleTtl) || idleTtl <= 0) {
    throw new AxiomifyError(
      '[axiomify/session] `idleTimeout` must be a positive number of seconds.',
    );
  }
  if (
    options.absoluteTimeout !== undefined &&
    (!Number.isFinite(options.absoluteTimeout) || options.absoluteTimeout <= 0)
  ) {
    throw new AxiomifyError(
      '[axiomify/session] `absoluteTimeout` must be a positive number of seconds.',
    );
  }

  let store = options.store;
  if (!store) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[axiomify/session] Using the in-memory MemorySessionStore in ' +
          'production. It is per-process: sessions are not shared across ' +
          'workers or instances and are lost on restart. Provide a ' +
          'RedisSessionStore (or other SessionStore) for real deployments.',
      );
    }
    store = new MemorySessionStore();
  }

  return {
    cookieName,
    secrets,
    cookie,
    store,
    rolling: options.rolling ?? false,
    saveUninitialized: options.saveUninitialized ?? false,
    idleTtl,
    absoluteTimeout: options.absoluteTimeout,
  };
}

function storeSessionOnRequest(req: AxiomifyRequest, session: Session): void {
  const state = req.state as unknown as Record<string, unknown> & {
    set?: (key: string, value: unknown) => void;
  };
  // RequestStateImpl keys are write-once; we set `session` exactly once per
  // request. Mutating the session object's own properties afterwards is
  // unaffected — write-once guards the state KEY, not the stored object.
  if (typeof state.set === 'function') state.set('session', session);
  else state['session'] = session;
}

function isValidRecord(record: unknown): record is SessionRecord {
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof (record as SessionRecord).createdAt === 'number' &&
    typeof (record as SessionRecord).data === 'object' &&
    (record as SessionRecord).data !== null
  );
}

async function attachSession(
  ctx: SessionPluginContext,
  req: AxiomifyRequest,
  res: AxiomifyResponse,
): Promise<void> {
  // Prefer the adapter's own lazily-memoized req.cookies when it provides
  // one — falling back to getCookies(req) only for adapters that don't.
  // Both parse the same Cookie header independently; preferring req.cookies
  // avoids a redundant parse on any request where application code (or
  // another plugin) also reads req.cookies directly.
  const raw = (req.cookies ?? getCookies(req))[ctx.cookieName];
  let internal: SessionInternal | undefined;

  if (raw) {
    const unsigned = unsignCookieValue(raw, ctx.secrets);
    if (unsigned.valid && unsigned.value) {
      // Store errors propagate (fail closed): silently degrading to a fresh
      // anonymous session during a store outage would log users out and
      // mask the incident.
      const record = await ctx.store.get(unsigned.value);
      if (record != null && isValidRecord(record)) {
        const expiredAbsolutely =
          ctx.absoluteTimeout !== undefined &&
          Date.now() - record.createdAt >= ctx.absoluteTimeout * 1000;
        if (expiredAbsolutely) {
          await ctx.store.destroy(unsigned.value);
        } else {
          internal = new SessionInternal(
            ctx,
            req,
            res,
            unsigned.value,
            false,
            record.data,
            record.createdAt,
          );
        }
      }
    }
    // Tampered signature / unknown ID / expired → fall through to a fresh
    // anonymous session. Never trust or reuse a client-supplied ID.
  }

  if (!internal) {
    internal = new SessionInternal(
      ctx,
      req,
      res,
      newSessionId(),
      true,
      {},
      Date.now(),
    );
  }

  storeSessionOnRequest(req, createSessionProxy(internal));

  // ── Eager Set-Cookie ──────────────────────────────────────────────────
  // By onPostHandler the response has usually been flushed, so cookies must
  // be queued during onRequest (or mid-handler) while headers are writable:
  //  - new session + saveUninitialized → cookie now (it WILL be persisted);
  //  - existing session + rolling      → re-issue now to slide the expiry;
  //  - new session, saveUninitialized=false → LAZY: the first data write
  //    (Proxy set trap) queues the cookie synchronously. Tradeoff: no
  //    cookie churn for read-only anonymous traffic, but a write performed
  //    after res.send() cannot deliver its cookie (warned once, see
  //    setCookieNow).
  if (internal.isNew) {
    if (ctx.saveUninitialized) internal.setCookieNow();
  } else if (ctx.rolling) {
    internal.setCookieNow();
  }
}

async function persistSession(req: AxiomifyRequest): Promise<void> {
  const state = req.state as unknown as Record<string, unknown> & {
    get?: (key: string) => unknown;
  };
  const session = (
    typeof state.get === 'function' ? state.get('session') : state['session']
  ) as Session | undefined;
  if (!session) return;
  const internal = session[kInternal as unknown as string] as
    SessionInternal | undefined;
  if (internal) await internal.persist();
}

/**
 * Access the request's session. Throws when `useSession()` was not
 * registered (or another onRequest hook ended the request before the
 * session hook ran).
 */
export function getSession(req: AxiomifyRequest): Session {
  const state = req.state as unknown as Record<string, unknown> & {
    get?: (key: string) => unknown;
  };
  const session =
    typeof state.get === 'function' ? state.get('session') : state['session'];
  if (!session) {
    throw new AxiomifyError(
      '[axiomify/session] No session found on this request. Did you register useSession(app, { secret })?',
    );
  }
  return session as Session;
}

/**
 * Build the session AppModule. Prefer {@link useSession} unless you need to
 * declare it as a dependency of another module.
 */
export function createSessionModule(options: SessionOptions): AppModule {
  const ctx = buildPluginContext(options);
  return {
    name: '@axiomify/session',
    register(app, di) {
      di.provide('sessionStore', ctx.store);
      app.addHook('onRequest', (req, res) => attachSession(ctx, req, res));
      // Happy path: persist once the handler pipeline finished.
      app.addHook('onPostHandler', (req) => persistSession(req));
      // Safety net: handler errors and unmatched routes bypass onPostHandler
      // (the dispatcher throws past it / returns early), but onClose always
      // runs in the dispatcher's finally block. persist() is idempotent.
      app.addHook('onClose', (req) => persistSession(req));
    },
  };
}

/**
 * Register cookie sessions on an Axiomify app.
 *
 * ```ts
 * useSession(app, {
 *   secret: process.env.SESSION_SECRET!,
 *   cookie: { maxAge: 86_400, sameSite: 'lax' },
 *   store: new RedisSessionStore(redis),
 * });
 * ```
 */
export function useSession(app: Axiomify, options: SessionOptions): void {
  app.use(createSessionModule(options));
}
