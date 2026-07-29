# @axiomify/cache

[![npm version](https://img.shields.io/npm/v/@axiomify/cache.svg)](https://npmjs.com/package/@axiomify/cache)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Response caching for Axiomify — always-on ETag/conditional GET for dynamic responses, an opt-in shared response cache with stale-while-revalidate, `Cache-Control` helpers and pluggable memory/Redis stores. Zero dependencies.

## Install

```bash
npm install @axiomify/cache
```

## Quick start

```typescript
import { useCache, cached } from '@axiomify/cache';

const cache = useCache(app, { defaultTtl: 60, staleWhileRevalidate: 300 });

// ETag + If-None-Match → 304 is now active for every GET/HEAD response.

// Opt a route into the shared response cache:
app.route({
  method: 'GET',
  path: '/products',
  plugins: [cached({ ttl: 120, swr: 600 })],
  handler,
});

// Invalidate after a write:
await cache.invalidatePath('/products');
```

Cache hits are served during `onRequest`, **before routing — the handler never runs on a hit**. Responses carry `X-Cache: HIT | STALE | MISS | EXPIRED` and an `Age` header.

## Options

| Option                 | Type                         | Default               | Description                                                                                                      |
| ---------------------- | ---------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `store`                | `CacheStore`                 | `new MemoryCacheStore()` | Cache backend.                                                                                                  |
| `defaultTtl`           | `number` (s)                 | `30`                  | Freshness lifetime for cached responses without their own `cached({ ttl })`.                                       |
| `staleWhileRevalidate` | `number` (s)                 | `0`                   | Global SWR grace (see below). `0` = stale entries are plain misses.                                                |
| `etag`                 | `'weak' \| 'strong' \| false`| `'weak'`              | ETag emission + conditional-GET handling. `'weak'` is safe with serializers that embed request-derived fields.     |
| `routes`               | `string[]`                   | `[]`                  | Path prefixes opted into the shared cache globally (`'/'` = every route). Prefixes match on segment boundaries.    |
| `varyHeaders`          | `string[]`                   | `[]`                  | Request headers folded into the primary cache key — each value combination is its own entry (multi-variant).       |
| `cachePrivate`         | `boolean`                    | `false`               | Allow caching requests with `Authorization`/`Cookie` and `Cache-Control: private` responses. Only with a key that captures the per-user variance. |
| `cacheableStatuses`    | `number[]`                   | `[200, 203, 301, 404]`| Statuses eligible for the shared cache.                                                                            |
| `refreshLockTtl`       | `number` (s)                 | `30`                  | Lifetime of the SWR refresh claim (recovers from a revalidator that died mid-flight).                              |

## Conditional GET (always on)

Every 2xx GET/HEAD response gets an `ETag` (SHA-1 of the final serialized body, weak by default — the same 27-char format Express/Fastify emit). A matching `If-None-Match` (RFC 9110 weak comparison, `*` and lists included) answers `304 Not Modified` with no body. This works for **every** route, cached or not, and costs one hash per response. Set `etag: false` to disable.

## Shared response cache (opt-in)

Only GET/HEAD responses on opted-in routes are stored — via `cached()` per route (or route group) or `routes` prefixes globally. A response is **never** stored when:

- the request carries `Authorization` or `Cookie` (unless `cachePrivate`),
- the response sets a cookie (`res.cookie()` or a `Set-Cookie` header),
- the response says `Cache-Control: no-store` (or `private`, unless `cachePrivate`),
- the status is outside `cacheableStatuses`, or the effective TTL is `0`.

Keys are `method + path + normalized query` (sorted, so `?b=2&a=1` and `?a=1&b=2` share an entry), plus any global `varyHeaders`. Per-route `cached({ varyHeaders })` stores one variant per key and treats a header mismatch as a miss.

### Stale-while-revalidate

- Within `ttl`: served as `X-Cache: HIT`.
- Between `ttl` and `ttl + swr`: **exactly one** request claims the refresh (atomic across the fleet with `RedisCacheStore`; per-process otherwise) and falls through to the handler — its response replaces the entry (`X-Cache: EXPIRED`). Every other request is served the stale entry instantly (`X-Cache: STALE`).
- Past `ttl + swr`: plain miss.

## Cache-Control helpers

```typescript
import { cacheControl, noCache } from '@axiomify/cache';

app.route({ method: 'GET', path: '/assets/logo',
  plugins: [cacheControl({ scope: 'public', maxAge: 31536000, immutable: true })], handler });

app.route({ method: 'GET', path: '/me', plugins: [noCache], handler }); // no-store, no-cache, must-revalidate
```

The header is built and validated once at route definition; a handler-set `Cache-Control` always wins — and is what the write-through gate inspects, so `noCache` also keeps a response out of the shared cache.

## Invalidation

`useCache()` returns the `CacheApi`; `createCacheModule()` additionally provides it in DI as `'cache'`:

```typescript
app.use(createCacheModule({ defaultTtl: 60 }));
const cache = app.resolve('cache');

await cache.invalidate('/products', { query: { page: 1 } }); // exact path+query
await cache.invalidatePath('/products');                     // all query/vary variants
await cache.clear();                                         // everything
```

## Stores

- **`MemoryCacheStore`** — per-process LRU with entry (`maxEntries: 1000`) and byte (`maxBytes: 32 MiB`) bounds, lazy + background expiry (unref'd timer, `close()` to stop). A payload larger than the byte budget is never stored.
- **`RedisCacheStore`** — bring your own `ioredis` or `redis@4` client. Entries expire via `SET … EX`; the SWR refresh lock uses `SET … EX NX`, so exactly one instance fleet-wide revalidates. `deleteByPrefix` uses `KEYS` — fine for explicit invalidation, not the hot path.
- **Custom** — implement `CacheStore` (`get`/`set`/`delete`/`clear`, optional `deleteByPrefix` for `invalidatePath()` and `acquireRefreshLock`/`releaseRefreshLock` for distributed SWR).

Store failures never break requests: `get` errors fail open to the handler, writes are fire-and-forget.
