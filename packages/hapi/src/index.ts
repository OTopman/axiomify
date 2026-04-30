import type { Axiomify, AxiomifyRequest, SerializerFn } from '@axiomify/core';
import type { Request } from '@hapi/hapi';
import Hapi from '@hapi/hapi';
import crypto from 'crypto';
import { PassThrough, Readable } from 'stream';
import { sanitize } from './utils';

export class HapiAdapter {
  private server: Hapi.Server;
  private readonly bodyLimitBytes: number;

  constructor(
    private core: Axiomify,
    config: Hapi.ServerOptions = {},
  ) {
    const configuredPayload = config.routes?.payload || {};
    this.bodyLimitBytes =
      typeof configuredPayload.maxBytes === 'number'
        ? configuredPayload.maxBytes
        : 1_048_576;

    // We keep `parse: false, output: 'stream'` so that @axiomify/upload can
    // pipe the raw request into Busboy. That means JSON / urlencoded bodies
    // arrive here as an unread stream — we parse them ourselves per-request
    // below so route handlers see a plain object like they do on every other
    // adapter.
    this.server = Hapi.server({
      ...config,
      routes: {
        ...(config.routes || {}),
        payload: {
          ...configuredPayload,
          maxBytes: this.bodyLimitBytes,
          output: 'stream',
          parse: false,
        },
      },
    });

    this.server.route({
      method: '*',
      path: '/{any*}',
      handler: async (req: any, h: any) => {
        let parsedBody: unknown;
        try {
          parsedBody = await this.parseBody(req);
        } catch (err: any) {
          const statusCode =
            typeof err?.statusCode === 'number'
              ? err.statusCode
              : typeof err?.status === 'number'
                ? err.status
                : 500;
          const message =
            statusCode === 413
              ? 'Payload Too Large'
              : statusCode === 400
                ? 'Bad Request'
                : 'Internal Server Error';
          const axiomifyReq = this.translateRequest(req, undefined);
          return h
            .response(
              this.core.serializer(null, message, statusCode, true, axiomifyReq),
            )
            .code(statusCode);
        }
        return new Promise((resolve, reject) => {
          const axiomifyReq = this.translateRequest(req, parsedBody);
          // Inject the serializer here
          const axiomifyRes = this.translateResponse(
            h,
            resolve,
            this.core.serializer,
            axiomifyReq,
          );

          this.core.handle(axiomifyReq, axiomifyRes).catch((err) => {
            axiomifyRes.error(err);
          });

          // Respects timeout:0 as "disabled"; core already handles timeout
          // internally, so the Hapi adapter does not add a second independent timeout.
          // The core's own timeout mechanism (Promise.race + setTimeout) fires first
          // and rejects the handler promise, which our .catch() above will handle.
          // We only add the Hapi-level safety net when the core timeout is disabled (0)
          // so a runaway handler can't stall a Hapi request forever.
          const coreTimeout = this.core.timeout;
          if (coreTimeout === 0) {
            const backstopMs = 30_000;
            setTimeout(() => {
              if (!axiomifyRes.headersSent) {
                reject(
                  new Error(
                    `Handler did not respond within the ${backstopMs}ms backstop timeout.`,
                  ),
                );
              }
            }, backstopMs).unref();
          }
        });
      },
    });
  }

  /**
   * Parses the request payload stream for non-multipart content types.
   * Multipart is left untouched so @axiomify/upload can drive it; GET/HEAD/
   * OPTIONS never have a body to parse.
   */
  private async parseBody(req: any): Promise<unknown> {
    const method = (req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return undefined;
    }

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) return undefined;

    const stream = req.payload;
    if (!stream || typeof stream.on !== 'function') return undefined;

    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      stream.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > this.bodyLimitBytes) {
          stream.destroy(
            Object.assign(new Error('Payload Too Large'), {
              statusCode: 413,
            }),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (chunks.length === 0) return resolve(undefined);
        const body = Buffer.concat(chunks).toString('utf8');
        if (contentType.includes('application/json')) {
          try {
            resolve(sanitize(JSON.parse(body)));
          } catch {
            reject(
              Object.assign(new Error('Invalid JSON body'), {
                statusCode: 400,
              }),
            );
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          resolve(Object.fromEntries(new URLSearchParams(body)));
        } else {
          resolve(body);
        }
      });
      stream.on('error', reject);
    });
  }

  private translateRequest(req: Request, parsedBody: unknown): AxiomifyRequest {
    const _params = {};
    const _state = {};
    const controller = new AbortController();
    const rawReq = req.raw.req;
    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('Client aborted request'));
      }
    };
    rawReq.once('aborted', abort);
    rawReq.once('close', () => {
      if (rawReq.destroyed) abort();
    });

    return {
      get id() {
        return (
          (req.headers['x-request-id'] as string) ||
          req.info.id ||
          crypto.randomUUID()
        );
      },
      get method() {
        return req.method.toUpperCase() as AxiomifyRequest['method'];
      },
      get url() {
        return req.url.href;
      },
      get path() {
        return req.path;
      },
      get ip() {
        return req.info.remoteAddress;
      },
      get headers() {
        return req.headers;
      },
      get body() {
        return parsedBody;
      },
      get query() {
        return req.query;
      },
      get params() {
        return _params;
      },
      get state() {
        return _state;
      },
      get raw() {
        return req;
      },
      get stream() {
        return rawReq;
      },
      get signal() {
        return controller.signal;
      },
    };
  }

  private translateResponse(
    h: any,
    resolve: (val: any) => void,
    serializer: SerializerFn,
    req: AxiomifyRequest,
  ): any {
    let statusCode = 200;
    let isSent = false;
    let sseStream: PassThrough | null = null;
    const headers: Record<string, string> = {};

    const applyHeaders = (response: any) => {
      for (const [key, value] of Object.entries(headers)) {
        response.header(key, value);
      }
      return response;
    };

    return {
      status(code: number) {
        statusCode = code;
        return this;
      },
      header(key: string, value: string) {
        headers[key] = value;
        return this;
      },
      removeHeader(key: string) {
        delete headers[key];
        return this;
      },
      send(data: any, message?: string) {
        isSent = true;
        const isError = statusCode >= 400;
        const payload = serializer(data, message, statusCode, isError, req);
        const response = h.response(payload).code(statusCode);
        resolve(applyHeaders(response));
      },
      sendRaw(payload: any, contentType = 'text/plain') {
        isSent = true;
        headers['Content-Type'] = contentType;
        const response = h.response(payload).code(statusCode);
        resolve(applyHeaders(response));
      },
      error(err: unknown) {
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = serializer(null, message, 500, true, req);
        const response = h.response(payload).code(500);
        resolve(applyHeaders(response));
      },

      // Hapi Stream implementation
      stream(readable: Readable, contentType = 'application/octet-stream') {
        isSent = true;
        headers['Content-Type'] = contentType;
        const response = h.response(readable).code(statusCode);
        resolve(applyHeaders(response));
      },

      // Hapi SSE Init (Creates and returns a PassThrough stream)
      sseInit(sseHeartbeatMs: number = 15_000) {
        isSent = true;
        sseStream = new PassThrough();

        headers['Content-Type'] = 'text/event-stream';
        headers['Cache-Control'] = 'no-cache';
        headers['Connection'] = 'keep-alive';

        const heartbeat = setInterval(() => {
          sseStream!.write(': keepalive\n\n');
        }, sseHeartbeatMs);
        sseStream.on('close', () => clearInterval(heartbeat));

        const response = h.response(sseStream).code(200);
        resolve(applyHeaders(response));
      },

      // Hapi SSE Send (Writes to the PassThrough stream)
      sseSend(data: any, event?: string) {
        if (!sseStream) return;
        if (event) sseStream.write(`event: ${event}\n`);
        sseStream.write(`data: ${JSON.stringify(data)}\n\n`);
      },

      get statusCode() {
        return statusCode;
      },

      get raw() {
        return h;
      },
      get headersSent() {
        return isSent;
      },
    };
  }

  public async listen(port: number): Promise<void> {
    this.server.settings.port = port;
    await this.server.start();
  }

  public async close(): Promise<void> {
    await this.server.stop({ timeout: 10000 }); // Graceful drain
  }
}
