import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';

/**
 * Minimal Node.js IncomingMessage polyfill for NativeRequest.
 *
 * Express / Connect middleware typically reads from:
 *   req.headers, req.method, req.url, req.socket.remoteAddress
 * and may call req.on('data', ...) / req.on('end', ...).
 *
 * This stub satisfies those contracts so standard middleware can run inside
 * the native adapter via `adaptMiddleware`.
 */
export function createNodeReqPolyfill(
  req: AxiomifyRequest,
): Record<string, unknown> {
  return {
    headers: req.headers,
    method: req.method,
    url: req.url,
    originalUrl: req.url,
    ip: req.ip,
    socket: { remoteAddress: req.ip },
    connection: { remoteAddress: req.ip },
    on(event: string, cb: (data?: unknown) => void): void {
      if (event === 'data' || event === 'end') {
        throw new Error(
          `[Axiomify/native] Fatal: Express middleware attempted to consume the request body stream via req.on('${event}'). ` +
            `This is strictly prohibited. Axiomify parses bodies natively before middleware runs. ` +
            `Remove body-parser, multer, or express.json() from your adapter pipeline.`,
        );
      }
    },
  };
}

/**
 * Minimal Node.js ServerResponse polyfill for NativeResponse.
 *
 * Express / Connect middleware typically reads or writes:
 *   res.statusCode, res.setHeader, res.getHeader, res.removeHeader, res.end
 */
export function createNodeResPolyfill(
  res: AxiomifyResponse,
): Record<string, unknown> {
  return {
    get statusCode() {
      return res.statusCode;
    },
    set statusCode(code: number) {
      res.status(code);
    },

    setHeader(name: string, value: string | string[]): void {
      if (Array.isArray(value)) {
        res.header(name, value.join(', '));
      } else {
        res.header(name, value);
      }
    },

    getHeader(name: string): string | undefined {
      // Delegate to AxiomifyResponse which tracks headers correctly.
      return res.getHeader(name);
    },

    removeHeader(name: string): void {
      res.removeHeader(name);
    },

    end(chunk?: string | Buffer): void {
      if (chunk) {
        const contentType = res.getHeader('Content-Type') ?? 'text/plain';
        res.sendRaw(chunk, contentType);
      } else {
        res.sendRaw('');
      }
    },

    write(_chunk: unknown): void {
      throw new Error(
        '[Axiomify/native] Chunked writes via res.write() are not supported in ' +
          'the native bridge. For streaming responses, use res.stream() directly.',
      );
    },
  };
}

/**
 * Wraps a standard Express/Connect middleware function so it can run inside
 * the native uWS adapter.
 *
 * ⚠️  SAFE ONLY FOR A NARROW CLASS OF MIDDLEWARE — READ BEFORE USING.
 *
 * `adaptMiddleware` provides a polyfill of Node.js `IncomingMessage` and
 * `ServerResponse` via {@link createNodeReqPolyfill} and
 * {@link createNodeResPolyfill}. These polyfills are NOT full stream
 * implementations. The following middleware categories will SILENTLY
 * MALFUNCTION or CORRUPT request state:
 *
 *   ✗  Body parsers  (multer, busboy, formidable, express.json, body-parser)
 *      — The body has already been consumed and parsed by the adapter before
 *        your middleware runs. Any middleware that calls `req.on('data')`
 *        will receive stale buffered data via queueMicrotask, causing it to
 *        double-parse and overwrite the already-correct `req.body`.
 *
 *   ✗  Streaming middleware  (compression, proxy middleware, http-proxy)
 *      — `res.write()` in the polyfill throws immediately. Middleware that
 *        writes chunks rather than calling `end()` once will crash.
 *
 *   ✗  Cookie parsers that depend on `req.connection.remoteAddress`
 *      — The polyfill returns a stub socket. Some middleware reads properties
 *        not present on the stub and throws.
 *
 * ✓  SAFE classes of middleware (read-headers / set-headers / call-next):
 *      cors, helmet, express-rate-limit (memory store only), basic-auth,
 *      custom auth/logging middleware that only reads req.headers.
 *
 * If your middleware falls outside the safe class, rewrite it as a native
 * Axiomify RouteMiddleware or use `addHook('onRequest', ...)` instead.
 *
 * @example
 * import { adaptMiddleware } from '@axiomify/native';
 * import cors from 'cors';
 *
 * app.route({
 *   method: 'GET',
 *   path: '/data',
 *   plugins: [adaptMiddleware(cors())],
 *   handler: async (req, res) => res.send({ ok: true }),
 * });
 */
const UNSAFE_MIDDLEWARE_NAMES = new Set([
  'jsonParser',
  'urlencodedParser',
  'bodyParser',
  'multer',
  'compression',
]);

/* v8 ignore start -- express middleware bridge requires live uWS context */
export function adaptMiddleware(
  middleware: (
    req: unknown,
    res: unknown,
    next: (err?: unknown) => void,
  ) => void,
) {
  const name = middleware.name || '';
  if (
    UNSAFE_MIDDLEWARE_NAMES.has(name) ||
    name.toLowerCase().includes('bodyparser')
  ) {
    console.warn(
      `[axiomify/native] Warning: Bridging middleware "${name}" may be unsafe. ` +
        `Body parsers, file uploaders, and compression middleware from Express ` +
        `can interfere with Axiomify's native request lifecycle or uWebSockets.js stream handling. ` +
        `Use Axiomify's native plugins instead (e.g. @axiomify/upload).`,
    );
  }

  return (req: AxiomifyRequest, res: AxiomifyResponse): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const nodeReq = createNodeReqPolyfill(req);
      const nodeRes = createNodeResPolyfill(res);

      try {
        middleware(nodeReq, nodeRes, (err?: unknown) => {
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  };
}
/* v8 ignore stop */
