/**
 * Application/x-www-form-urlencoded and URL query-string parser.
 *
 * Why we don't use Node's `URLSearchParams`:
 *   1. `URLSearchParams.getAll(key)` for every key requires deduping the key
 *      set first — O(n) extra walks. The single-pass parser below collects
 *      multi-value keys natively.
 *   2. `URLSearchParams.entries()` returns a `Record<string, string>` after
 *      a manual reduction; we want `Record<string, string | string[]>` to
 *      match `AxiomifyRequest.query`.
 *   3. URLSearchParams throws on malformed percent-encoding (`%E0`, `%XY`).
 *      Real clients send these all the time — we tolerate via
 *      `safeDecodeURIComponent` below.
 *   4. Module-level state and prototype concerns: the output uses
 *      `Object.create(null)` so `__proto__` keys can never pollute the
 *      prototype chain.
 */

/**
 * Tolerant `decodeURIComponent` — returns the raw (un-decoded) string when
 * the input contains malformed percent-encoding instead of throwing
 * `URIError: URI malformed`. Form bodies and query strings from real clients
 * regularly include bytes that look like the start of a percent escape but
 * aren't valid UTF-8 (`%E0` truncated, `%XY` non-hex, etc.); rejecting those
 * with a 500 is worse than passing the literal bytes through. The handler
 * can still validate the resulting string via Zod.
 */
export function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parses a URL query string or form-urlencoded body in a single pass.
 *
 * Output invariants (also pinned by `query-parser.fuzz.test.ts`):
 *   - Returns `Object.create(null)` (no prototype, no `__proto__` pollution).
 *   - Values are `string` for single-occurrence keys, `string[]` for repeated.
 *   - Never throws on any input string — malformed percent-encoding falls
 *     through to `safeDecodeURIComponent`.
 *   - `&&&...` floods run in linear time (no O(n²) string concat).
 */
export function fastParseQuery(str: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  if (!str) return result;

  let start = 0;
  let eqIdx = -1;
  const len = str.length;

  for (let i = 0; i <= len; i++) {
    if (i === len || str.charCodeAt(i) === 38) {
      // 38 is '&'
      if (start === i) {
        start = i + 1;
        eqIdx = -1;
        continue;
      }

      const keyEnd = eqIdx === -1 ? i : eqIdx;

      // Form bodies encode spaces as '+'. Replace before decoding.
      const keyStr = str.substring(start, keyEnd).replace(/\+/g, ' ');
      const valStr =
        eqIdx === -1 ? '' : str.substring(eqIdx + 1, i).replace(/\+/g, ' ');

      const key = safeDecodeURIComponent(keyStr);
      const val = safeDecodeURIComponent(valStr);

      const existing = result[key];
      if (existing === undefined) {
        result[key] = val;
      } else if (Array.isArray(existing)) {
        existing.push(val);
      } else {
        result[key] = [existing, val];
      }

      start = i + 1;
      eqIdx = -1;
    } else if (str.charCodeAt(i) === 61 && eqIdx === -1) {
      // 61 is '='
      eqIdx = i;
    }
  }
  return result;
}
