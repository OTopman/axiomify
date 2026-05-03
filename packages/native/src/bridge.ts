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
export function createNodeReqPolyfill(req: AxiomifyRequest): Record<string, unknown> {
  return {
    headers: req.headers,
    method: req.method,
    url: req.url,
    originalUrl: req.url,
    ip: req.ip,
    socket: { remoteAddress: req.ip },
    connection: { remoteAddress: req.ip },
    on(event: string, cb: (data?: unknown) => void): void {
      // Emit buffered body data so middleware that reads the stream
      // (e.g. body parsers) receives the already-parsed content.
      if (event === 'data' && req.body !== undefined) {
        const raw =
          req.body instanceof Buffer
            ? req.body
            : Buffer.from(JSON.stringify(req.body));
        // Defer to give the caller time to attach all event handlers.
        queueMicrotask(() => cb(raw));
      }
      if (event === 'end') {
        queueMicrotask(() => cb());
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
export function createNodeResPolyfill(res: AxiomifyResponse): Record<string, unknown> {
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
 * any Axiomify adapter — including the native uWS adapter.
 *
 * @example
 * import { adaptMiddleware } from '@axiomify/native';
 * import helmet from 'helmet';
 *
 * app.route({
 *   method: 'GET',
 *   path: '/secure',
 *   plugins: [adaptMiddleware(helmet())],
 *   handler: async (req, res) => res.send({ ok: true }),
 * });
 */
export function adaptMiddleware(
  middleware: (req: unknown, res: unknown, next: (err?: unknown) => void) => void,
) {
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
