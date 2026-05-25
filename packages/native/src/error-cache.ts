import type { SerializerFn } from '@axiomify/core';
import { makeSerialize } from '@axiomify/core';

// ---------------------------------------------------------------------------
// Status line cache
// RFC 7231 + common extensions — pre-built strings avoid allocations per send.
// ---------------------------------------------------------------------------

const HTTP_STATUS_PHRASES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

// Module-level Map is safe here — it's a write-once-per-code cache of pure
// `${code} ${phrase}` strings. Two adapters in the same process sharing this
// cache is correct (the strings would be identical anyway).
const STATUS_LINE_CACHE = new Map<number, string>();

/**
 * Returns the cached HTTP status line for the given code, computing and
 * caching it on first access. Falls back to `<code> Unknown` for codes
 * outside the well-known set.
 */
export function statusLine(code: number): string {
  let line = STATUS_LINE_CACHE.get(code);
  if (!line) {
    line = `${code} ${HTTP_STATUS_PHRASES[code] ?? 'Unknown'}`;
    STATUS_LINE_CACHE.set(code, line);
  }
  return line;
}

// ---------------------------------------------------------------------------
// Pre-serialised error payloads (per-adapter)
//
// 404/405/413/500 responses are emitted from cached strings so they never
// allocate JSON in the hot path. The cache is built ONCE per adapter — never
// at module scope — because multiple Axiomify instances in the same process
// can have different serializers. A module-level cache would let one
// adapter's serializer overwrite another's mid-flight, silently corrupting
// the error envelope shape downstream consumers rely on.
// ---------------------------------------------------------------------------

export interface CachedError {
  statusLine: string;
  body: string;
}

export interface ErrorCache {
  cached404: CachedError;
  /** Body only — the `Allow` header differs per route. */
  cached405Body: string;
  cached413: CachedError;
  cached500: CachedError;
}

export function buildErrorCache(serializer: SerializerFn): ErrorCache {
  const serialize = makeSerialize(serializer);
  const make = (statusCode: number, message: string): CachedError => ({
    statusLine: statusLine(statusCode),
    body: JSON.stringify(
      serialize({ data: null, message, statusCode, isError: true }),
    ),
  });
  return {
    cached404: make(404, 'Route not found'),
    cached405Body: JSON.stringify(
      serialize({
        data: null,
        message: 'Method Not Allowed',
        statusCode: 405,
        isError: true,
      }),
    ),
    cached413: make(413, 'Payload Too Large'),
    cached500: make(500, 'Internal Server Error'),
  };
}
