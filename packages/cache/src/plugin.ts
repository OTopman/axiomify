import type {
  AppModule,
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  RouteMiddleware,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { makeSerialize } from '@axiomify/core';
import { computeEtag, ifNoneMatchMatches, type EtagMode } from './etag';
import {
  buildCacheKey,
  getRequestHeader,
  pathKeyPrefix,
  requestCacheKey,
} from './key';
import { MemoryCacheStore, type CacheEntry, type CacheStore } from './store';

/**
 * `req.state` key under which `cached()` stores its per-route marker.
 * Read by the write-through gate at send time.
 */
export const CACHE_STATE_KEY = '@axiomify/cache:route';

interface CachedMarker {
  ttl?: number;
  swr?: number;
  varyHeaders?: string[];
}

export interface CachedOptions {
  /** Freshness lifetime in seconds. Falls back to `useCache`'s `defaultTtl`. */
  ttl?: number;
  /**
   * Stale-while-revalidate grace in seconds. Falls back to `useCache`'s
   * `staleWhileRevalidate`.
   */
  swr?: number;
  /**
   * Request headers this route's response varies on. Stored inside the entry
   * and checked as a secondary key on lookup: a request whose header values
   * differ from the stored ones is a **miss** (and its response replaces the
   * entry). One variant per key — for multi-variant caching configure the
   * headers globally via `useCache({ varyHeaders })`, which folds them into
   * the primary key.
   */
  varyHeaders?: string[];
}

/**
 * Route middleware that opts a route into `useCache`'s shared response cache
 * — the per-route alternative to the global `routes: [prefixes]` option.
 *
 * ```ts
 * app.route({
 *   method: 'GET', path: '/products',
 *   plugins: [cached({ ttl: 120, swr: 300, varyHeaders: ['Accept-Language'] })],
 *   handler,
 * });
 * ```
 *
 * The marker is written to `req.state`, so it can only influence the
 * **write** side (plugins run after the `onRequest` cache lookup). Reads are
 * driven by the stored entry itself: its ttl/swr/vary are the ones this
 * middleware supplied at write time.
 */
export function cached(options: CachedOptions = {}): RouteMiddleware {
  const marker: CachedMarker = {
    ttl: options.ttl,
    swr: options.swr,
    varyHeaders: options.varyHeaders?.length
      ? options.varyHeaders.map((h) => h.toLowerCase())
      : undefined,
  };
  return (req: AxiomifyRequest) => {
    const state = req.state as Record<string, unknown>;
    // RequestState keys are immutable once set — guard against double
    // registration (e.g. cached() in both group and route plugins).
    if (state[CACHE_STATE_KEY] === undefined) {
      state[CACHE_STATE_KEY] = marker;
    }
  };
}

export interface CacheOptions {
  /** Cache backend. Default: `new MemoryCacheStore()` (per-process LRU). */
  store?: CacheStore;
  /**
   * Freshness lifetime in seconds for cached responses that don't specify
   * their own via `cached({ ttl })`. Default: 30.
   */
  defaultTtl?: number;
  /**
   * Global stale-while-revalidate grace in seconds (see the SWR section of
   * the package docs). Default: 0 (stale entries are plain misses).
   */
  staleWhileRevalidate?: number;
  /**
   * ETag emission for GET/HEAD responses: `'weak'` (default), `'strong'`, or
   * `false` to disable ETag + conditional-GET handling entirely.
   */
  etag?: false | 'strong' | 'weak';
  /**
   * Path prefixes opted into the shared response cache globally (e.g.
   * `['/api/catalog', '/public']`). `'/'` opts in every route. Prefixes match
   * on segment boundaries: `/api` matches `/api` and `/api/x`, never `/apix`.
   * Routes outside these prefixes can still opt in per-route via `cached()`.
   */
  routes?: string[];
  /**
   * Request headers every cache key varies on globally. Folded into the
   * primary key, so each distinct value combination is its own entry
   * (multi-variant). For per-route, single-variant vary use
   * `cached({ varyHeaders })`.
   */
  varyHeaders?: string[];
  /**
   * Allow caching of requests that carry `Authorization` or `Cookie` headers,
   * and of responses marked `Cache-Control: private`. Only enable when the
   * cache key fully captures the per-user variance (e.g. a global
   * `varyHeaders: ['Authorization']`). Default: false.
   */
  cachePrivate?: boolean;
  /**
   * Response statuses eligible for the shared cache.
   * Default: `[200, 203, 301, 404]`.
   */
  cacheableStatuses?: number[];
  /**
   * Lifetime in seconds of the SWR refresh claim. If the refreshing request
   * dies before writing a fresh entry, the claim expires and the next
   * staleness-discoverer takes over. Default: 30.
   */
  refreshLockTtl?: number;
}

/** Invalidation surface, also provided as the `'cache'` DI service. */
export interface CacheApi {
  /** The underlying store (escape hatch for custom invalidation). */
  readonly store: CacheStore;
  /**
   * Delete the entry for an exact path (and optional query object /
   * method). Without `method`, both GET and HEAD entries are removed.
   * Note: with global `varyHeaders` configured, keys carry vary values this
   * method cannot reconstruct — use {@link invalidatePath} instead.
   */
  invalidate(
    path: string,
    options?: { method?: 'GET' | 'HEAD'; query?: unknown },
  ): Promise<void>;
  /**
   * Delete every entry for a path — all query-string and vary variants.
   * Requires a store implementing `deleteByPrefix()` (both first-party
   * stores do).
   */
  invalidatePath(path: string, method?: 'GET' | 'HEAD'): Promise<void>;
  /** Drop every entry. */
  clear(): Promise<void>;
}

const DEFAULT_CACHEABLE_STATUSES = [200, 203, 301, 404];

/** `X-Cache` header values emitted by the plugin. */
export type XCacheValue = 'HIT' | 'STALE' | 'MISS' | 'EXPIRED';

function normalizePrefix(prefix: string): string {
  const p = prefix.endsWith('/') && prefix !== '/' ? prefix.slice(0, -1) : prefix;
  return p === '' ? '/' : p;
}

/**
 * Response caching and conditional-GET for Axiomify.
 *
 * Registers a single `onRequest` hook that:
 *
 *  1. **Serves cache hits** for eligible GET/HEAD requests before routing —
 *     `res.headersSent` short-circuits the dispatcher, so the handler never
 *     runs on a hit.
 *  2. **Wraps `res.send` / `res.sendRaw`** on the way in, to (a) emit an
 *     `ETag` and answer `If-None-Match` with `304`, and (b) write eligible
 *     responses through to the store after they are sent.
 *
 * Returns the {@link CacheApi} invalidation surface. Prefer
 * {@link createCacheModule} when you want the API available via DI as the
 * `'cache'` service.
 */
export function useCache(app: Axiomify, options: CacheOptions = {}): CacheApi {
  const store = options.store ?? new MemoryCacheStore();
  const etagMode: false | EtagMode = options.etag ?? 'weak';
  const defaultTtl = options.defaultTtl ?? 30;
  const defaultSwr = options.staleWhileRevalidate ?? 0;
  const globalVary = (options.varyHeaders ?? []).map((h) => h.toLowerCase());
  const cachePrivate = options.cachePrivate ?? false;
  const cacheableStatuses = new Set(
    options.cacheableStatuses ?? DEFAULT_CACHEABLE_STATUSES,
  );
  const routePrefixes = (options.routes ?? []).map(normalizePrefix);
  const refreshLockTtl = options.refreshLockTtl ?? 30;

  // Per-process refresh flags for stores without acquireRefreshLock().
  const localRefreshFlags = new Map<string, number>();

  // The app serializer is replicated here so the ETag and the cached payload
  // are computed over the FINAL body bytes — identical to what the adapter's
  // send() produces. Memoized on serializer identity: makeSerialize() probes
  // the function, so rebuilding it per request would be wasteful.
  let lastSerializer: SerializerFn | undefined;
  let serialize: (input: SerializerInput) => unknown = (i) => i.data;
  const getSerialize = () => {
    const current = app.serializer;
    if (current !== lastSerializer) {
      lastSerializer = current;
      serialize = makeSerialize(current);
    }
    return serialize;
  };

  const acquireRefresh = async (key: string): Promise<boolean> => {
    if (typeof store.acquireRefreshLock === 'function') {
      try {
        return await store.acquireRefreshLock(key, refreshLockTtl);
      } catch {
        // Lock backend unavailable — don't refresh (serving stale is safe).
        return false;
      }
    }
    const now = Date.now();
    const heldUntil = localRefreshFlags.get(key);
    if (heldUntil !== undefined && heldUntil > now) return false;
    localRefreshFlags.set(key, now + refreshLockTtl * 1000);
    return true;
  };

  const releaseRefresh = (key: string): void => {
    if (typeof store.releaseRefreshLock === 'function') {
      void Promise.resolve(store.releaseRefreshLock(key)).catch(() => {});
    } else {
      localRefreshFlags.delete(key);
    }
  };

  /**
   * A request may be answered from / written to the shared cache only when it
   * carries no credentials — `Authorization` and `Cookie` responses are
   * per-user by default. `cachePrivate: true` lifts this (the operator
   * asserts the key captures the variance).
   */
  const isRequestEligible = (req: AxiomifyRequest): boolean => {
    if (cachePrivate) return true;
    return (
      getRequestHeader(req, 'authorization') === undefined &&
      getRequestHeader(req, 'cookie') === undefined
    );
  };

  const matchesRoutePrefix = (path: string): boolean => {
    for (const prefix of routePrefixes) {
      if (prefix === '/') return true;
      if (path === prefix || path.startsWith(`${prefix}/`)) return true;
    }
    return false;
  };

  /** Secondary-key check for per-route vary constraints stored in the entry. */
  const varyMatches = (entry: CacheEntry, req: AxiomifyRequest): boolean => {
    if (!entry.vary) return true;
    for (const name of Object.keys(entry.vary)) {
      if ((getRequestHeader(req, name) ?? '') !== entry.vary[name]) {
        return false;
      }
    }
    return true;
  };

  const serveEntry = (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    entry: CacheEntry,
    kind: XCacheValue,
    ageMs: number,
  ): void => {
    res.header('X-Cache', kind);
    res.header('Age', String(Math.max(0, Math.floor(ageMs / 1000))));
    if (entry.etag && etagMode !== false) {
      res.header('ETag', entry.etag);
      if (
        ifNoneMatchMatches(
          req.headers['if-none-match'] as string | string[] | undefined,
          entry.etag,
        )
      ) {
        res.status(304);
        res.sendRaw('');
        return;
      }
    }
    res.status(entry.statusCode);
    // RFC 9110 §9.3.2 — HEAD responses carry headers only.
    res.sendRaw(req.method === 'HEAD' ? '' : entry.payload, entry.contentType);
  };

  const wrapResponse = (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    key: string,
    reqEligible: boolean,
    refreshing: boolean,
  ): void => {
    const originalSend = res.send.bind(res);
    const originalSendRaw = res.sendRaw.bind(res);

    // Adapters keep Set-Cookie lines outside the regular header map
    // (RFC 6265 forbids folding), so getHeader('Set-Cookie') can miss
    // cookies queued via res.cookie(). Intercept it too.
    let sawSetCookie = false;
    if (typeof res.cookie === 'function') {
      const originalCookie = res.cookie.bind(res);
      res.cookie = (name, value, cookieOptions) => {
        sawSetCookie = true;
        originalCookie(name, value, cookieOptions);
        return res;
      };
    }
    if (typeof res.header === 'function') {
      const originalHeader = res.header.bind(res);
      res.header = (name: string, value: any) => {
        if (typeof name === 'string' && name.toLowerCase() === 'set-cookie') {
          sawSetCookie = true;
        }
        return originalHeader(name, value);
      };
    }

    const getHeaderCaseInsensitive = (name: string): string | undefined => {
      const lower = name.toLowerCase();
      const direct =
        res.getHeader(name) ??
        res.getHeader(lower) ??
        res.getHeader('Set-Cookie') ??
        res.getHeader('set-cookie');
      if (direct !== undefined) return direct;
      if (typeof (res as any).getHeaders === 'function') {
        const headers = (res as any).getHeaders();
        if (headers) {
          const foundKey = Object.keys(headers).find(
            (k) => k.toLowerCase() === lower,
          );
          if (foundKey) return headers[foundKey];
        }
      }
      return undefined;
    };

    let finished = false;

    const shouldStore = (status: number): { ttl: number; swr: number } | null => {
      if (!reqEligible) return null;
      if (!cacheableStatuses.has(status)) return null;
      if (sawSetCookie || getHeaderCaseInsensitive('set-cookie') !== undefined)
        return null;
      // Never cache a response another plugin has already content-encoded
      // (e.g. @axiomify/compress running "inside" this hook's wrapper chain).
      // This entry's `payload` would be compressed bytes with no
      // Content-Encoding recorded in the CacheEntry — a later HIT would
      // replay them unlabeled to a client whose Accept-Encoding may differ.
      // Checking here makes caching safe regardless of plugin registration
      // order: whichever wrapper runs first still sees this header as unset.
      if (res.getHeader('Content-Encoding')) return null;
      const cc = (res.getHeader('Cache-Control') ?? '').toLowerCase();
      if (cc.includes('no-store')) return null;
      if (cc.includes('private') && !cachePrivate) return null;
      const marker = (req.state as Record<string, unknown>)?.[
        CACHE_STATE_KEY
      ] as CachedMarker | undefined;
      if (marker === undefined && !matchesRoutePrefix(req.path)) return null;
      const ttl = marker?.ttl ?? defaultTtl;
      const swr = marker?.swr ?? defaultSwr;
      if (!(ttl > 0)) return null;
      return { ttl, swr };
    };

    const finish = (
      body: string | Buffer,
      contentType: string,
      emit: () => void,
    ): void => {
      if (finished || res.headersSent) {
        emit();
        return;
      }
      finished = true;
      const status = res.statusCode;

      // ── ETag / conditional GET (2xx only) ────────────────────────────────
      let etag = res.getHeader('ETag') ?? res.getHeader('etag');
      if (etagMode !== false && status >= 200 && status < 300) {
        if (!etag) {
          etag = computeEtag(body, etagMode);
          res.header('ETag', etag);
        }
        if (
          ifNoneMatchMatches(
            req.headers['if-none-match'] as string | string[] | undefined,
            etag,
          )
        ) {
          // Not modified: no body, and — per the spec of this plugin — no
          // cache write (the client already holds the representation; the
          // next unconditional request will populate the cache).
          if (refreshing) releaseRefresh(key);
          res.status(304);
          originalSendRaw('');
          return;
        }
      }

      // ── Write-through decision (before emit, so X-Cache lands in headers) ─
      const freshness = shouldStore(status);
      if (freshness) {
        res.header('X-Cache', refreshing ? 'EXPIRED' : 'MISS');
      }

      emit();

      if (freshness) {
        const marker = (req.state as Record<string, unknown>)?.[
          CACHE_STATE_KEY
        ] as CachedMarker | undefined;
        let vary: Record<string, string> | undefined;
        if (marker?.varyHeaders?.length) {
          vary = {};
          for (const name of marker.varyHeaders) {
            vary[name] = getRequestHeader(req, name) ?? '';
          }
        }
        const entry: CacheEntry = {
          payload: typeof body === 'string' ? body : body.toString('utf8'),
          statusCode: status,
          contentType,
          etag,
          storedAt: Date.now(),
          ttlMs: freshness.ttl * 1000,
          swrMs: freshness.swr * 1000,
          vary,
        };
        // Fire-and-forget: send() is synchronous by contract, and a failed
        // cache write must never fail the already-delivered response.
        void Promise.resolve(
          store.set(key, entry, freshness.ttl + freshness.swr),
        ).catch(() => {});
      }
      if (refreshing) releaseRefresh(key);
    };

    res.send = <T>(data: T, message?: string): void => {
      if (res.headersSent) return;
      let payload: unknown;
      let body: string | undefined;
      try {
        payload = getSerialize()({
          data,
          message,
          statusCode: res.statusCode,
          isError: res.statusCode >= 400,
          req,
        });
        body = JSON.stringify(payload);
      } catch {
        // Serializer misbehaved — never let caching break the response.
        originalSend(data, message);
        return;
      }
      if (body === undefined) {
        // Serializer produced no body — nothing to cache or reuse; let the
        // real send() pipeline decide how that's represented.
        originalSend(data, message);
        return;
      }
      // Delegate the ALREADY-SERIALIZED body via sendRaw instead of
      // re-invoking send() with the raw `data` — when another plugin (e.g.
      // @axiomify/compress) is wrapped underneath this one, its send()
      // wrapper would otherwise redo this exact serializer + JSON.stringify
      // pass. Preserve `res.payload`/`res.responseMessage` — the same
      // fields NativeResponse.send() itself sets — so introspection
      // consumers (@axiomify/logger's includeResponsePayload,
      // @axiomify/openapi) see identical values either way.
      finish(body, 'application/json', () => {
        (res as unknown as Record<string, unknown>).payload = payload;
        (res as unknown as Record<string, unknown>).responseMessage = message;
        originalSendRaw(
          req.method === 'HEAD' ? '' : (body as string),
          'application/json',
        );
      });
    };

    res.sendRaw = (payload: unknown, contentType?: string): void => {
      if (res.headersSent) return;
      const body =
        typeof payload === 'string' || Buffer.isBuffer(payload)
          ? payload
          : String(payload);
      finish(body, contentType ?? 'text/plain', () =>
        originalSendRaw(
          req.method === 'HEAD' ? '' : payload,
          contentType,
        ),
      );
    };
  };

  app.addHook('onRequest', async (req, res) => {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD') return;
    if (res.headersSent) return;

    const reqEligible = isRequestEligible(req);
    const key = requestCacheKey(req, globalVary);
    let refreshing = false;

    if (reqEligible) {
      let entry: CacheEntry | undefined;
      try {
        entry = await store.get(key);
      } catch {
        // Store unavailable — fail open, serve from the handler.
      }
      if (entry && varyMatches(entry, req)) {
        const age = Date.now() - entry.storedAt;
        if (age <= entry.ttlMs) {
          serveEntry(req, res, entry, 'HIT', age);
          return;
        }
        if (age <= entry.ttlMs + entry.swrMs) {
          if (await acquireRefresh(key)) {
            // This request is the designated revalidator: fall through to
            // the handler; its response replaces the stale entry.
            refreshing = true;
          } else {
            serveEntry(req, res, entry, 'STALE', age);
            return;
          }
        }
        // Past ttl + swr: treat as a plain miss (backend expiry usually
        // removed the entry already; this covers clock-skewed leftovers).
      }
    }

    wrapResponse(req, res, key, reqEligible, refreshing);
  });

  const api: CacheApi = {
    store,
    async invalidate(path, opts = {}) {
      const methods = opts.method ? [opts.method] : (['GET', 'HEAD'] as const);
      for (const m of methods) {
        await store.delete(buildCacheKey(m, path, opts.query));
      }
    },
    async invalidatePath(path, method) {
      if (typeof store.deleteByPrefix !== 'function') {
        throw new Error(
          '[axiomify/cache] invalidatePath() requires a store implementing ' +
            'deleteByPrefix(). MemoryCacheStore and RedisCacheStore both do; ' +
            'add it to your custom store or use invalidate()/clear().',
        );
      }
      const methods = method ? [method] : (['GET', 'HEAD'] as const);
      for (const m of methods) {
        await store.deleteByPrefix(pathKeyPrefix(m, path));
      }
    },
    async clear() {
      await store.clear();
    },
  };
  return api;
}

/**
 * {@link useCache} packaged as an Axiomify {@link AppModule}. Registers the
 * caching hook and provides the {@link CacheApi} as the `'cache'` DI service:
 *
 * ```ts
 * app.use(createCacheModule({ store, defaultTtl: 60 }));
 * // later, e.g. in another module or handler setup:
 * const cache = app.resolve('cache');
 * await cache.invalidatePath('/products');
 * ```
 */
export function createCacheModule(options: CacheOptions = {}): AppModule {
  return {
    name: '@axiomify/cache',
    register(app, context) {
      const api = useCache(app, options);
      context.provide('cache', api);
    },
  };
}

declare module '@axiomify/core' {
  interface AppServices {
    cache: CacheApi;
  }
}
