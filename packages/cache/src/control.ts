import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteMiddleware,
} from '@axiomify/core';

export interface CacheControlOptions {
  /** `max-age=N` — freshness lifetime in seconds for any cache. */
  maxAge?: number;
  /** `s-maxage=N` — freshness lifetime for shared caches (CDNs, proxies). */
  sMaxage?: number;
  /** `public` or `private` — whether shared caches may store the response. */
  scope?: 'public' | 'private';
  /** `immutable` — the representation never changes within its lifetime. */
  immutable?: boolean;
  /** `stale-while-revalidate=N` — serve stale for N seconds while refetching. */
  staleWhileRevalidate?: number;
  /**
   * `no-store` — forbid storing entirely. Mutually exclusive with every other
   * directive; when set, the header is exactly `no-store` and all other
   * options are rejected at construction time.
   */
  noStore?: boolean;
  /** `must-revalidate` — once stale, never serve without revalidation. */
  mustRevalidate?: boolean;
}

/**
 * Build a `Cache-Control` header value from structured options.
 * Exported for direct use in handlers and tests.
 */
export function buildCacheControl(options: CacheControlOptions): string {
  if (options.noStore) {
    const others = { ...options } as Record<string, unknown>;
    delete others.noStore;
    if (Object.values(others).some((v) => v !== undefined)) {
      throw new Error(
        '[axiomify/cache] cacheControl({ noStore: true }) cannot be combined ' +
          'with other directives — `no-store` forbids storing, so freshness ' +
          'directives alongside it are contradictory.',
      );
    }
    return 'no-store';
  }
  const parts: string[] = [];
  if (options.scope) parts.push(options.scope);
  if (options.maxAge !== undefined) parts.push(`max-age=${options.maxAge}`);
  if (options.sMaxage !== undefined) parts.push(`s-maxage=${options.sMaxage}`);
  if (options.mustRevalidate) parts.push('must-revalidate');
  if (options.immutable) parts.push('immutable');
  if (options.staleWhileRevalidate !== undefined) {
    parts.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }
  if (parts.length === 0) {
    throw new Error(
      '[axiomify/cache] cacheControl() requires at least one directive.',
    );
  }
  return parts.join(', ');
}

/**
 * Route middleware that sets a `Cache-Control` header.
 *
 * The header value is built (and validated) **once** at route-definition
 * time — the per-request work is a single header check + write.
 *
 * Precedence: the middleware never overwrites a `Cache-Control` that is
 * already present when it runs (set by an earlier hook or middleware), and
 * because route plugins run *before* the handler, a handler that calls
 * `res.header('Cache-Control', …)` always wins. The handler's value is also
 * what `useCache`'s write-through gate inspects — a handler-set `no-store`
 * (or `private`, unless `cachePrivate`) keeps the response out of the shared
 * cache.
 *
 * @example
 * app.route({
 *   method: 'GET', path: '/assets/logo',
 *   plugins: [cacheControl({ scope: 'public', maxAge: 31536000, immutable: true })],
 *   handler,
 * });
 */
export function cacheControl(options: CacheControlOptions): RouteMiddleware {
  const value = buildCacheControl(options);
  return (_req: AxiomifyRequest, res: AxiomifyResponse) => {
    if (res.getHeader('Cache-Control')) return;
    res.header('Cache-Control', value);
  };
}

/**
 * Preset middleware for responses that must never be cached anywhere —
 * `Cache-Control: no-store, no-cache, must-revalidate`. Also keeps the
 * response out of `useCache`'s shared cache (the write-through gate skips
 * any response whose Cache-Control contains `no-store`).
 */
export const noCache: RouteMiddleware = (
  _req: AxiomifyRequest,
  res: AxiomifyResponse,
) => {
  if (res.getHeader('Cache-Control')) return;
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate');
};
