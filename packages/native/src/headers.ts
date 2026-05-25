import type { HttpRequest as UWSRequest } from 'uWebSockets.js';

/**
 * Matches any character that MUST NOT appear in an HTTP header name or value
 * per RFC 9110 §5.1, §5.5. CR (\r), LF (\n), and NUL (\0) are the canonical
 * header-injection vectors — embedding them in a header value lets an
 * attacker split the response and inject a fully forged second response.
 *
 * Used by `NativeResponse.header()` to reject malicious user input before
 * it reaches uWS's `writeHeader` (which does not validate).
 */
export const HEADER_INJECTION_PATTERN = /[\r\n\0]/;

/**
 * Collects request headers into an `AxiomifyRequest`-shaped object. uWS's
 * `req.forEach((k, v) => ...)` can fire more than once for the same header
 * name (RFC 9110 §5.3 — repeated headers like `Forwarded`, `Via`, `Accept`,
 * and any custom multi-value header). A previous version of this code did
 * `headers[k] = v` and silently dropped all but the last value — that lost
 * data and was a header-injection foothold (an attacker sending two
 * `Authorization` headers could influence which one downstream plugins read).
 *
 * After this fn, a header observed once is a `string`; observed multiple
 * times it's `string[]` (insertion order preserved). Matches the contract
 * advertised by `AxiomifyRequest.headers`.
 */
export function collectHeaders(
  req: UWSRequest,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  req.forEach((k: string, v: string) => {
    const existing = headers[k];
    if (existing === undefined) {
      headers[k] = v;
    } else if (Array.isArray(existing)) {
      existing.push(v);
    } else {
      headers[k] = [existing, v];
    }
  });
  return headers;
}
