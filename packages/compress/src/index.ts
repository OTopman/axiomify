import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  RouteMiddleware,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { makeSerialize } from '@axiomify/core';
import type { Readable, Transform } from 'node:stream';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

/** Content-Encoding tokens this plugin can produce. */
export type CompressEncoding = 'br' | 'gzip' | 'deflate' | 'zstd';

export interface CompressOptions {
  /**
   * Minimum payload size in bytes before compression kicks in.
   * Tiny payloads gain nothing from compression (the encoding header and
   * dictionary overhead can even grow them) and just burn CPU.
   * @default 1024
   */
  threshold?: number;
  /**
   * Server preference order of encodings to offer. Defaults to
   * `['br', 'gzip', 'deflate']`, with `'zstd'` appended automatically when
   * the running Node's zlib exposes it (Node >= 23.8 / 24). Requesting
   * `'zstd'` on a runtime without zstd support drops it with a warning.
   */
  encodings?: CompressEncoding[];
  /**
   * MIME allowlist. Entries are matched against the response Content-Type
   * with parameters stripped (`text/html; charset=utf-8` → `text/html`).
   * Entries ending in `/*` match by prefix (`text/*`).
   * `text/event-stream` is always excluded — compressing SSE breaks
   * event delivery through buffering proxies and the EventSource protocol.
   * @default ['text/*', 'application/json', 'application/javascript', 'image/svg+xml', 'application/xml']
   */
  compressibleTypes?: string[];
  /** Options forwarded to zlib's brotli compressor. */
  brotliOptions?: zlib.BrotliOptions;
  /** Options forwarded to zlib's gzip AND deflate compressors. */
  gzipOptions?: zlib.ZlibOptions;
}

const DEFAULT_THRESHOLD = 1024;
const DEFAULT_TYPES = [
  'text/*',
  'application/json',
  'application/javascript',
  'image/svg+xml',
  'application/xml',
];

// ── zstd feature detection ────────────────────────────────────────────────────
// zlib.zstdCompress landed in Node 23.8 / 24. Older runtimes simply do not
// offer the encoding — negotiation never selects what we cannot produce.
const zstdCompressFn = (
  zlib as unknown as Record<string, ((...a: any[]) => void) | undefined>
)['zstdCompress'];
const createZstdCompressFn = (
  zlib as unknown as Record<string, ((opts?: unknown) => Transform) | undefined>
)['createZstdCompress'];

/** Whether the running Node exposes zstd compression in node:zlib. */
export const ZSTD_SUPPORTED =
  typeof zstdCompressFn === 'function' &&
  typeof createZstdCompressFn === 'function';

const brotliAsync = promisify(zlib.brotliCompress);
const gzipAsync = promisify(zlib.gzip);
const deflateAsync = promisify(zlib.deflate);
const zstdAsync = ZSTD_SUPPORTED
  ? (promisify(zstdCompressFn!) as (buf: Buffer) => Promise<Buffer>)
  : null;

const KNOWN_ENCODINGS = new Set<string>(['br', 'gzip', 'deflate', 'zstd']);

// ── req.state opt-out flag ────────────────────────────────────────────────────

const DISABLE_KEY = 'axiomify:compress:disabled';

/**
 * Route middleware that opts a single route out of response compression.
 *
 * @example
 * app.route({
 *   method: 'GET',
 *   path: '/download/report',
 *   plugins: [disableCompression],
 *   handler: ...,
 * });
 */
export const disableCompression: RouteMiddleware = (req) => {
  const state = req.state as unknown as Record<string, unknown> & {
    get?: (k: string) => unknown;
    set?: (k: string, v: unknown) => void;
  };
  if (!state) return;
  if (typeof state.get === 'function' && state.get(DISABLE_KEY) === true) {
    return; // already flagged — core state keys are immutable once set
  }
  if (typeof state.set === 'function') {
    state.set(DISABLE_KEY, true);
  } else {
    state[DISABLE_KEY] = true;
  }
};

function isCompressionDisabled(req: AxiomifyRequest): boolean {
  const state = req.state as unknown as Record<string, unknown> & {
    get?: (k: string) => unknown;
  };
  if (!state) return false;
  if (typeof state.get === 'function' && state.get(DISABLE_KEY) === true) {
    return true;
  }
  return state[DISABLE_KEY] === true;
}

// ── Accept-Encoding negotiation ───────────────────────────────────────────────

/** Parse an Accept-Encoding header into a token → q-value map. */
function parseAcceptEncoding(header: string): Map<string, number> {
  const prefs = new Map<string, number>();
  for (const part of header.split(',')) {
    const segments = part.split(';');
    const name = segments[0].trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (let i = 1; i < segments.length; i++) {
      const eq = segments[i].indexOf('=');
      if (eq === -1) continue;
      if (segments[i].slice(0, eq).trim().toLowerCase() !== 'q') continue;
      const parsed = parseFloat(segments[i].slice(eq + 1));
      if (!Number.isNaN(parsed)) q = Math.min(Math.max(parsed, 0), 1);
    }
    prefs.set(name, q);
  }
  return prefs;
}

/**
 * Pick the encoding to use for a request, or `null` for identity.
 *
 * - Highest client q-value wins; ties break by server preference order.
 * - `q=0` excludes a token (including via `*;q=0`).
 * - An explicit `identity` with a higher q than every acceptable encoding
 *   selects identity (no compression). `identity;q=0` alone does not force
 *   compression — if nothing else is acceptable we still send identity
 *   rather than failing the response with 406.
 * - No Accept-Encoding header → identity.
 */
function negotiateEncoding(
  header: string | undefined,
  serverOrder: readonly string[],
): CompressEncoding | null {
  if (!header) return null;
  const prefs = parseAcceptEncoding(header);
  if (prefs.size === 0) return null;
  const star = prefs.get('*');

  let best: CompressEncoding | null = null;
  let bestQ = 0;
  for (const enc of serverOrder) {
    const q = prefs.has(enc) ? prefs.get(enc)! : star !== undefined ? star : 0;
    if (q > bestQ) {
      best = enc as CompressEncoding;
      bestQ = q;
    }
  }
  if (best === null) return null;

  // Respect an explicit client preference for identity over our best pick.
  const identityQ = prefs.has('identity')
    ? prefs.get('identity')!
    : star !== undefined
      ? star
      : 0;
  if (identityQ > bestQ) return null;
  return best;
}

// ── MIME allowlist ────────────────────────────────────────────────────────────

function isCompressibleType(
  contentType: string,
  allowlist: readonly string[],
): boolean {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime === 'text/event-stream') return false;
  for (const entry of allowlist) {
    if (entry.endsWith('/*')) {
      if (mime.startsWith(entry.slice(0, -1))) return true;
    } else if (mime === entry) {
      return true;
    }
  }
  return false;
}

// ── Vary handling ─────────────────────────────────────────────────────────────

/** Append `Accept-Encoding` to Vary without duplicating existing entries. */
function appendVary(res: AxiomifyResponse): void {
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.header('Vary', 'Accept-Encoding');
    return;
  }
  const entries = String(existing)
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.some((e) => e.toLowerCase() === 'accept-encoding' || e === '*')) {
    return;
  }
  entries.push('Accept-Encoding');
  res.header('Vary', entries.join(', '));
}

// ── Compression primitives ────────────────────────────────────────────────────

function compressBuffer(
  buf: Buffer,
  encoding: CompressEncoding,
  options: CompressOptions,
): Promise<Buffer> {
  switch (encoding) {
    case 'br': {
      const brotliOptions: zlib.BrotliOptions = {
        ...options.brotliOptions,
        params: {
          // Size hint lets brotli pick a better window without extra passes.
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength,
          ...options.brotliOptions?.params,
        },
      };
      return brotliAsync(buf, brotliOptions);
    }
    case 'gzip':
      return gzipAsync(buf, options.gzipOptions ?? {});
    case 'deflate':
      return deflateAsync(buf, options.gzipOptions ?? {});
    case 'zstd':
      /* v8 ignore next 4 -- requires a Node build with zlib zstd support */
      if (!zstdAsync) {
        return Promise.reject(
          new Error('zstd is not supported by this Node runtime'),
        );
      }
      return zstdAsync(buf);
  }
}

function createCompressStream(
  encoding: CompressEncoding,
  options: CompressOptions,
): Transform {
  switch (encoding) {
    case 'br':
      return zlib.createBrotliCompress(options.brotliOptions);
    case 'gzip':
      return zlib.createGzip(options.gzipOptions);
    case 'deflate':
      return zlib.createDeflate(options.gzipOptions);
    case 'zstd':
      /* v8 ignore next 4 -- requires a Node build with zlib zstd support */
      if (!createZstdCompressFn) {
        throw new Error('zstd is not supported by this Node runtime');
      }
      return createZstdCompressFn();
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Enable HTTP response compression (brotli / gzip / deflate, plus zstd when
 * the runtime supports it) for every response produced through
 * `res.send()`, `res.sendRaw()` and `res.stream()`.
 *
 * Zero dependencies — built entirely on `node:zlib`.
 *
 * @example
 * import { useCompress } from '@axiomify/compress';
 * useCompress(app, { threshold: 2048 });
 */
export function useCompress(
  app: Axiomify,
  options: CompressOptions = {},
): void {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const compressibleTypes = options.compressibleTypes ?? DEFAULT_TYPES;

  let serverOrder: CompressEncoding[];
  if (options.encodings) {
    for (const enc of options.encodings) {
      if (!KNOWN_ENCODINGS.has(enc)) {
        throw new Error(
          `[axiomify/compress] Unknown encoding "${enc}". ` +
            `Supported: br, gzip, deflate, zstd.`,
        );
      }
    }
    serverOrder = options.encodings.filter((enc) => {
      if (enc === 'zstd' && !ZSTD_SUPPORTED) {
        console.warn(
          '[axiomify/compress] "zstd" requested but node:zlib in this ' +
            'runtime does not expose zstd (requires Node >= 23.8). ' +
            'Dropping it from the offered encodings.',
        );
        return false;
      }
      return true;
    });
  } else {
    serverOrder = ['br', 'gzip', 'deflate'];
    /* v8 ignore next -- requires a Node build with zlib zstd support */
    if (ZSTD_SUPPORTED) serverOrder.push('zstd');
  }

  // makeSerialize() probes the serializer once; cache the wrapped function
  // and only rebuild if app.serializer is swapped before adapter binding.
  let cachedRaw: SerializerFn | null = null;
  let cachedSerialize: (input: SerializerInput) => unknown = () => undefined;
  const getSerialize = (): ((input: SerializerInput) => unknown) => {
    if (cachedRaw !== app.serializer) {
      cachedRaw = app.serializer;
      cachedSerialize = makeSerialize(cachedRaw);
    }
    return cachedSerialize;
  };

  app.addHook('onRequest', (req, res) => {
    const aeHeader = req.headers['accept-encoding'];
    const encoding = negotiateEncoding(
      Array.isArray(aeHeader) ? aeHeader.join(', ') : aeHeader,
      serverOrder,
    );

    const originalSend = res.send.bind(res);
    const originalSendRaw = res.sendRaw.bind(res);
    const originalStream = res.stream.bind(res);

    // 'sent' latches SYNCHRONOUSLY on the first send/sendRaw/stream call, so
    // a second call issued while compression is still in flight is dropped —
    // exactly the double-send semantics of the underlying adapter.
    let sent = false;

    /** Guards that make a response non-transformable regardless of payload. */
    const isUntransformable = (): boolean => {
      if (isCompressionDisabled(req)) return true;
      if (res.getHeader('Content-Encoding')) return true;
      if (res.statusCode === 206 || res.getHeader('Content-Range')) return true;
      const cacheControl = res.getHeader('Cache-Control');
      if (
        cacheControl &&
        /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(cacheControl)
      ) {
        return true;
      }
      return false;
    };

    const emitCompressed = (
      buf: Buffer,
      enc: CompressEncoding,
      contentType: string,
    ): void => {
      const status = res.statusCode;
      compressBuffer(buf, enc, options).then(
        (compressed) => {
          res.status(status);
          res.header('Content-Encoding', enc);
          // Any pre-set Content-Length refers to the identity representation
          // and is now wrong; let the adapter compute the compressed length.
          res.removeHeader('Content-Length');
          originalSendRaw(compressed, contentType);
        },
        /* v8 ignore next 5 -- zlib buffer compression does not fail on valid input */
        () => {
          // Compression failed — fall back to the identity payload.
          res.status(status);
          originalSendRaw(buf, contentType);
        },
      );
    };

    res.send = <T>(data: T, message?: string): void => {
      if (sent || res.headersSent) return;
      sent = true;

      // res.send() always produces application/json in first-party adapters.
      if (
        isUntransformable() ||
        !isCompressibleType('application/json', compressibleTypes)
      ) {
        return originalSend(data, message);
      }
      appendVary(res);
      // HEAD: headers only — delegate so the adapter suppresses the body.
      if (!encoding || req.method === 'HEAD') {
        return originalSend(data, message);
      }

      // NativeResponse.send() serializes + stringifies internally and writes
      // straight to the socket — its output cannot be intercepted. Replicate
      // the same pipeline here and emit through sendRaw instead.
      const serialize = getSerialize();
      const payload = serialize({
        data,
        message,
        statusCode: res.statusCode,
        isError: res.statusCode >= 400,
        req,
      });
      const body = JSON.stringify(payload);
      if (body === undefined) {
        // Serializer produced no body (e.g. an explicit no-content
        // response) — nothing to reuse; let the real send() pipeline
        // decide how that's represented.
        return originalSend(data, message);
      }
      if (Buffer.byteLength(body) < threshold) {
        // Delegate the ALREADY-SERIALIZED body via sendRaw instead of
        // re-invoking send() with the raw `data` — when another plugin
        // (e.g. @axiomify/cache) is wrapped underneath this one, its send()
        // wrapper would otherwise redo this exact serializer + JSON.stringify
        // pass. Preserve `res.payload`/`res.responseMessage` — the same
        // fields NativeResponse.send() itself sets — so introspection
        // consumers (@axiomify/logger's includeResponsePayload,
        // @axiomify/openapi) see identical values either way.
        (res as unknown as Record<string, unknown>).payload = payload;
        (res as unknown as Record<string, unknown>).responseMessage = message;
        return originalSendRaw(body, 'application/json');
      }
      emitCompressed(Buffer.from(body), encoding, 'application/json');
    };

    res.sendRaw = (payload: unknown, contentType?: string): void => {
      if (sent || res.headersSent) return;
      sent = true;

      // Default matches NativeResponse.sendRaw's contentType default.
      const ct = contentType ?? 'text/plain';
      if (isUntransformable() || !isCompressibleType(ct, compressibleTypes)) {
        return originalSendRaw(payload, contentType);
      }
      appendVary(res);
      const eligible = typeof payload === 'string' || Buffer.isBuffer(payload);
      if (!encoding || !eligible || req.method === 'HEAD') {
        return originalSendRaw(payload, contentType);
      }
      const buf =
        typeof payload === 'string'
          ? Buffer.from(payload)
          : (payload as Buffer);
      if (buf.byteLength < threshold) {
        return originalSendRaw(payload, contentType);
      }
      emitCompressed(buf, encoding, ct);
    };

    res.stream = (readable: Readable, contentType?: string): void => {
      if (sent || res.headersSent) return;
      sent = true;

      const ct = contentType ?? 'application/octet-stream';
      if (isUntransformable() || !isCompressibleType(ct, compressibleTypes)) {
        return originalStream(readable, contentType);
      }
      appendVary(res);
      // No threshold for streams — total size is unknown up front.
      if (!encoding || req.method === 'HEAD') {
        return originalStream(readable, contentType);
      }

      // Content-Encoding must be set BEFORE the original stream() call —
      // adapters flush headers as soon as streaming starts.
      res.header('Content-Encoding', encoding);
      res.removeHeader('Content-Length');
      const transform = createCompressStream(encoding, options);
      readable.on('error', (err: Error) => transform.destroy(err));
      originalStream(readable.pipe(transform), ct);
    };
  });
}
