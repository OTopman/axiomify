import type { HttpResponse as UWSResponse } from 'uWebSockets.js';
import { fastParseQuery } from './query';

// ---------------------------------------------------------------------------
// Optional simdjson acceleration
//
// `simdjson` ships native bindings that parse JSON measurably faster than V8's
// built-in JSON.parse — typically 20-40% faster on payloads over a few KB
// (smaller bodies are dominated by string allocation either way). The native
// binding consumes JS strings, so this is NOT a "no-allocation" path; the
// gain is in the parser internals, not in transcoding.
//
// The bindings DO NOT build on every platform (musl Alpine, some ARM
// containers, sandboxed CI) — a top-level static `import` would take the
// whole adapter down on those targets. Instead we:
//
//   1. Attempt `require('simdjson')` inside try/catch — load-time failure
//      degrades to V8 JSON.parse, the adapter still works.
//   2. Round-trip a probe payload — a binding that loads but is broken
//      (mismatched ABI, partial install) is treated the same as missing.
//   3. Set `simdParse = null` on either failure; the hot path checks for
//      null and uses JSON.parse.
//
// `simdjson` MUST be listed in `optionalDependencies` (not `dependencies`)
// for `npm install` to tolerate a build failure. The runtime fallback here
// is the second line of defence, not the first.
// ---------------------------------------------------------------------------

type SimdParseFn = (s: string) => unknown;
let _simdParse: SimdParseFn | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('simdjson') as { parse?: SimdParseFn };
  if (typeof mod.parse === 'function') {
    // Probe — a broken native binding can be required successfully but throw
    // on the first call. Catch that here so the hot path never sees it.
    mod.parse('{}');
    _simdParse = mod.parse;
  }
} catch {
  // Either the package isn't installed (optionalDependencies skipped on this
  // platform) or its native bindings failed to load / are broken. Either way,
  // fall back silently — every call site below checks `_simdParse !== null`.
  _simdParse = null;
}

/** Whether the simdjson binding loaded and probed successfully. */
export const simdjsonAvailable = _simdParse !== null;

// ---------------------------------------------------------------------------
// Body reading — zero-copy within uWS constraints
// ---------------------------------------------------------------------------

/**
 * Reads the full request body from uWS. The ArrayBuffer chunks provided by
 * `res.onData` are reused by uWS after each callback returns, so we MUST copy
 * them immediately via `Buffer.from(ab.slice(0))`. The `.slice(0)` clone is
 * essential — uWS's chunk is backed by reused memory; without the copy the
 * Buffer's view points at recycled data once the callback returns.
 *
 * Returns null if the connection was aborted before the body was complete.
 *
 * @param res        The uWS response handle.
 * @param maxSize    Maximum body size in bytes; resolves `{ tooLarge: true }`
 *                   when exceeded.
 * @param onAborted  Called when the client disconnects mid-body.
 */
export function readBody(
  res: UWSResponse,
  maxSize: number,
  onAborted: () => void,
): Promise<{ raw: Buffer; tooLarge: boolean } | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    res.onAborted(() => {
      if (!settled) {
        settled = true;
        onAborted();
        resolve(null);
      }
    });

    res.onData((ab: ArrayBuffer, isLast: boolean) => {
      if (settled) return;

      const chunk = Buffer.from(ab.slice(0));
      totalSize += chunk.byteLength;

      if (totalSize > maxSize) {
        settled = true;
        resolve({ raw: Buffer.alloc(0), tooLarge: true });
        return;
      }

      chunks.push(chunk);

      if (isLast) {
        settled = true;
        if (chunks.length === 0) {
          resolve(null);
        } else if (chunks.length === 1) {
          resolve({ raw: chunks[0], tooLarge: false });
        } else {
          resolve({ raw: Buffer.concat(chunks), tooLarge: false });
        }
      }
    });
  });
}

/**
 * Parse a raw Buffer into a request body based on Content-Type.
 *
 * - `application/json` → object (simdjson if available, V8 fallback)
 * - `application/x-www-form-urlencoded` → `Record<string, string | string[]>`
 * - anything else → the raw `Buffer` (consumed by `@axiomify/upload` etc).
 *
 * Returns `undefined` if JSON parsing fails — handler-level Zod validation
 * decides whether that's a 400.
 */
export function parseBodyBuffer(raw: Buffer, contentType: string): unknown {
  if (contentType.includes('application/json')) {
    try {
      if (_simdParse !== null) {
        return _simdParse(raw.toString('utf8'));
      }
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return undefined;
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return fastParseQuery(raw.toString('utf8'));
  }

  // Return raw Buffer — @axiomify/upload or custom handlers consume it.
  return raw;
}

/**
 * Direct access to the simdjson parser (or null if unavailable). Exposed so
 * the WebSocket message handler can use the same fast path as HTTP bodies.
 * @internal
 */
export function getSimdParse(): SimdParseFn | null {
  return _simdParse;
}
