import type { AxiomifyRequest } from '@axiomify/core';

/**
 * Key-segment separator. NUL cannot appear in an HTTP method, a URL path or a
 * percent-encoded query component, so joining with it is collision-free —
 * `GET /a?b=c` can never build the same key as `GET /a/b?=c`.
 */
export const KEY_SEPARATOR = '\u0000';

/**
 * Normalize a parsed query object into a canonical, sorted representation so
 * `?b=2&a=1` and `?a=1&b=2` share one cache entry.
 *
 *   - Keys are sorted lexicographically.
 *   - Array values (`?tag=a&tag=b`) are sorted too — repeated-parameter order
 *     rarely carries meaning, and normalizing it doubles the hit rate for
 *     clients that emit them in different orders.
 *   - Keys and values are percent-encoded so `&`/`=` inside values cannot
 *     forge a different logical query.
 */
export function normalizeQuery(query: unknown): string {
  if (query === null || query === undefined || typeof query !== 'object')
    return '';
  const source = query as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.length === 0) return '';
  const parts: string[] = [];
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      const items = value.map((v) => String(v)).sort();
      for (const item of items) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
      }
    } else if (value === undefined) {
      parts.push(encodeURIComponent(key));
    } else {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    }
  }
  return parts.join('&');
}

/** Case-insensitive request-header getter; folds string[] values with ', '. */
export function getRequestHeader(
  req: Pick<AxiomifyRequest, 'headers'>,
  name: string,
): string | undefined {
  const headers = req.headers ?? {};
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * Build the primary cache key: `method NUL path NUL normalizedQuery`, plus
 * one `NUL name:value` pair per configured global vary header.
 *
 * Vary headers configured **globally** (via `useCache({ varyHeaders })`) are
 * part of the primary key — every distinct value combination gets its own
 * entry (multi-variant caching). Vary headers configured **per route** (via
 * `cached({ varyHeaders })`) cannot be known before routing, so they are
 * stored inside the entry and checked as a secondary key on lookup instead
 * (single variant per key). See the package docs for the full semantics.
 */
export function buildCacheKey(
  method: string,
  path: string,
  query?: unknown,
  varyPairs?: ReadonlyArray<readonly [string, string]>,
): string {
  let key = `${method}${KEY_SEPARATOR}${path}${KEY_SEPARATOR}${normalizeQuery(query)}`;
  if (varyPairs && varyPairs.length > 0) {
    for (const [name, value] of varyPairs) {
      key += `${KEY_SEPARATOR}${name}:${value}`;
    }
  }
  return key;
}

/**
 * Prefix shared by every entry for a given method + path, regardless of query
 * string or vary values. Used by `invalidatePath()` with stores that support
 * `deleteByPrefix()`. The trailing separator guarantees `/users` never
 * matches `/users2`.
 */
export function pathKeyPrefix(method: string, path: string): string {
  return `${method}${KEY_SEPARATOR}${path}${KEY_SEPARATOR}`;
}

/** Build the primary key for an incoming request using the global vary config. */
export function requestCacheKey(
  req: Pick<AxiomifyRequest, 'method' | 'path' | 'query' | 'headers'>,
  globalVaryHeaders: readonly string[],
): string {
  let varyPairs: Array<[string, string]> | undefined;
  if (globalVaryHeaders.length > 0) {
    varyPairs = globalVaryHeaders.map((name) => [
      name.toLowerCase(),
      getRequestHeader(req, name) ?? '',
    ]);
  }
  return buildCacheKey(req.method, req.path, req.query, varyPairs);
}
