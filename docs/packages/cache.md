# @axiomify/cache

Response caching for Axiomify — always-on ETag/conditional GET, an opt-in shared response cache with stale-while-revalidate, `Cache-Control` helpers and pluggable memory/Redis stores. Zero dependencies.

## Install

```bash
npm install @axiomify/cache
```

## Exports

| Export                                                                                                          | Kind                            | Description                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCache`                                                                                                      | `(app, options?) => CacheApi`   | Register the caching hook; returns the invalidation API.                                                                                                                     |
| `createCacheModule`                                                                                             | `(options?) => AppModule`       | Same, packaged as a module; provides `CacheApi` in DI as `'cache'`.                                                                                                          |
| `cached`                                                                                                        | `(options?) => RouteMiddleware` | Opt a route into the shared response cache.                                                                                                                                  |
| `cacheControl` / `noCache`                                                                                      | `RouteMiddleware`               | Set `Cache-Control` per route.                                                                                                                                               |
| `buildCacheControl`                                                                                             | `(options) => string`           | Build (and validate) a `Cache-Control` value directly.                                                                                                                       |
| `computeEtag` / `parseIfNoneMatch` / `ifNoneMatchMatches`                                                       | —                               | ETag primitives (RFC 9110 weak comparison).                                                                                                                                  |
| `buildCacheKey` / `requestCacheKey` / `pathKeyPrefix` / `normalizeQuery` / `getRequestHeader` / `KEY_SEPARATOR` | —                               | Cache-key primitives.                                                                                                                                                        |
| `MemoryCacheStore` / `RedisCacheStore`                                                                          | classes                         | First-party stores.                                                                                                                                                          |
| `CACHE_STATE_KEY`                                                                                               | `string`                        | `req.state` key of the `cached()` marker.                                                                                                                                    |
| Types                                                                                                           | —                               | `CacheOptions`, `CachedOptions`, `CacheApi`, `CacheStore`, `CacheEntry`, `EtagMode`, `XCacheValue`, `MemoryCacheStoreOptions`, `RedisCacheClient`, `RedisCacheStoreOptions`. |

## Options (`CacheOptions`)

| Option                 | Type                          | Default                  | Description                                                                                                                                 |
| ---------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`                | `CacheStore`                  | `new MemoryCacheStore()` | Backend.                                                                                                                                    |
| `defaultTtl`           | `number` (s)                  | `30`                     | Freshness for entries without their own `cached({ ttl })`.                                                                                  |
| `staleWhileRevalidate` | `number` (s)                  | `0`                      | Global SWR grace; `cached({ swr })` overrides per route.                                                                                    |
| `etag`                 | `'weak' \| 'strong' \| false` | `'weak'`                 | ETag emission + conditional-GET. Weak is safe with serializers that embed request-derived fields.                                           |
| `routes`               | `string[]`                    | `[]`                     | Prefixes opted into the shared cache globally; `'/'` = all. Segment-boundary matching (`/api` matches `/api/x`, never `/apix`).             |
| `varyHeaders`          | `string[]`                    | `[]`                     | Folded into the **primary key** — multi-variant caching (one entry per value combination).                                                  |
| `cachePrivate`         | `boolean`                     | `false`                  | Allow caching credentialed requests / `private` responses. Only when the key captures the variance (e.g. `varyHeaders: ['Authorization']`). |
| `cacheableStatuses`    | `number[]`                    | `[200, 203, 301, 404]`   | Statuses eligible for the shared cache.                                                                                                     |
| `refreshLockTtl`       | `number` (s)                  | `30`                     | Lifetime of the SWR refresh claim; a dead revalidator's claim expires and the next staleness-discoverer takes over.                         |

## Conditional GET (always on)

For every 2xx GET/HEAD response the plugin emits an `ETag` — SHA-1 of the **final serialized body**, base64url, 27 chars (the `etag`-module format Express/Fastify use), `W/"…"` by default. A handler-set ETag is respected. `If-None-Match` is evaluated per RFC 9110 §13.1.2 with weak comparison (lists, `W/` prefixes, `*`, and commas inside quoted tags all handled); a match answers `304` with no body. A 304 is **not** written to the shared cache — the client already holds the representation; the next unconditional request populates it. `etag: false` disables all of this.

## Shared response cache

The plugin registers one `onRequest` hook: it serves hits **before routing** (the handler never runs on a hit) and wraps `res.send`/`res.sendRaw` to write eligible responses through to the store after they are sent. Responses carry `X-Cache` (`HIT`/`STALE`/`MISS`/`EXPIRED`) and `Age`.

### Opting in

- Globally: `useCache(app, { routes: ['/api/catalog'] })`.
- Per route: `plugins: [cached({ ttl, swr, varyHeaders })]`. The marker lives in `req.state` and only influences the **write** side (route plugins run after the cache lookup); reads are governed by the ttl/swr/vary stored inside the entry itself.
- Vary: global `varyHeaders` are part of the primary key (multi-variant). Per-route `cached({ varyHeaders })` stores the header values inside the entry as a secondary key — a mismatch is a miss whose response replaces the entry (one variant per key).

### Never cached

- Non-GET/HEAD requests.
- Requests carrying `Authorization` or `Cookie` (unless `cachePrivate`) — neither served from nor written to the cache.
- Responses that set a cookie (`res.cookie()` is intercepted, and the `Set-Cookie` header is checked).
- Responses with `Cache-Control: no-store`, or `private` unless `cachePrivate`.
- Statuses outside `cacheableStatuses`; effective ttl ≤ 0.

### Cache keys

Primary key: `method NUL path NUL normalizedQuery [NUL name:value …]` — NUL-separated (collision-free), query keys and repeated values sorted so `?b=2&a=1` and `?a=1&b=2` share an entry, components percent-encoded.

### Stale-while-revalidate — exact semantics

For a request whose entry has `age = now - storedAt`:

1. `age ≤ ttl` → served immediately, `X-Cache: HIT` (a matching `If-None-Match` against the stored ETag yields `304`).
2. `ttl < age ≤ ttl + swr` → the request tries to claim the refresh flag. **Exactly one** claimant per `refreshLockTtl` window wins (via `store.acquireRefreshLock` — atomic fleet-wide with Redis — or a per-process in-memory flag otherwise) and falls through to the handler; its response replaces the entry and is delivered to that client with `X-Cache: EXPIRED`. All other requests get the stale entry instantly with `X-Cache: STALE`. The refresh is _not_ a background fetch — the revalidating client waits for the handler. The claim is released after the fresh write (or on a 304 short-circuit); if the lock backend errors, the request serves stale rather than stampeding.
3. `age > ttl + swr` → plain miss (`X-Cache: MISS`; backend expiry usually removed the entry already).

Stores receive `ttl + swr` seconds as backend expiry, so stale-but-servable entries survive the whole window; freshness is always judged from `storedAt`/`ttlMs`/`swrMs`, never backend expiry.

### Failure behavior

`store.get` errors fail open (request goes to the handler); writes are fire-and-forget; a serializer error inside the wrapper falls back to the unwrapped `send`. Caching can never break a response.

## `Cache-Control` helpers

`cacheControl(options)` builds and validates the header **once** at route-definition time. Directives: `maxAge`, `sMaxage`, `scope: 'public' | 'private'`, `immutable`, `staleWhileRevalidate`, `mustRevalidate`, `noStore` (mutually exclusive — combining it with anything throws). The middleware never overwrites an existing header, and handler-set values win — they are also what the write-through gate inspects, so `no-store` (or `private` without `cachePrivate`) keeps a response out of the shared cache. `noCache` is a preset emitting `no-store, no-cache, must-revalidate`.

## Invalidation (`CacheApi` / `'cache'` DI service)

| Method                                  | Description                                                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalidate(path, { method?, query? })` | Delete the entry for an exact path (+ optional query object). Without `method`, both GET and HEAD keys are removed. With global `varyHeaders` configured the key can't be reconstructed — use `invalidatePath`. |
| `invalidatePath(path, method?)`         | Delete every entry for a path — all query and vary variants. Requires `store.deleteByPrefix()` (both first-party stores implement it; throws otherwise).                                                        |
| `clear()`                               | Drop everything.                                                                                                                                                                                                |
| `store`                                 | The underlying `CacheStore` (escape hatch).                                                                                                                                                                     |

## Stores

`CacheStore` interface: `get` / `set(key, entry, ttlSeconds)` / `delete` / `clear`, optional `deleteByPrefix` (for `invalidatePath`) and `acquireRefreshLock`/`releaseRefreshLock` (for distributed SWR). `CacheEntry` holds the final body string, status, content-type, ETag, `storedAt`, `ttlMs`, `swrMs` and optional per-route `vary` map — hits replay via `res.sendRaw(entry.payload, entry.contentType)`, bypassing the serializer.

- **`MemoryCacheStore`** — per-process LRU (`Map` recency order). `maxEntries` default 1000, `maxBytes` default 32 MiB (payload + key + overhead; an oversized payload is refused outright), lazy expiry + `unref`'d sweep (`sweepIntervalMs` default 60 000), `size`/`byteSize` diagnostics, `close()`. Implements the refresh lock in-process.
- **`RedisCacheStore(client, { keyPrefix = 'axiomify:cache:' })`** — BYO `ioredis` or `redis@4` client (style detected from `setex`/`setEx`, else probed once). Entries expire via `SET … EX`; the refresh lock is `SET … EX NX` — atomic across every process sharing the Redis. `deleteByPrefix`/`clear` use `KEYS` + `DEL` (glob-escaped, scoped by the prefix) — fine for explicit invalidation calls, not the hot path. Corrupt entries are dropped and read as misses.
