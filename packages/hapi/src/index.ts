import type { Axiomify, AxiomifyRequest, SerializerFn } from '@axiomify/core';
import type { Request } from '@hapi/hapi';
import Hapi from '@hapi/hapi';
import crypto from 'crypto';
import { PassThrough, Readable } from 'stream';
import { sanitize } from './utils';

/**
 * Converts an Axiomify route path to Hapi's path syntax.
 *
 * Axiomify: /users/:id/posts/:postId
 * Hapi:     /users/{id}/posts/{postId}
 *
 * Axiomify wildcard: /static/*
 * Hapi wildcard:     /static/{wild*}
 */
function toHapiPath(path: string): string {
  return path
    .replace(/:([^/]+)/g, '{$1}')   // :param  → {param}
    .replace(/\/\*$/,    '/{wild*}'); // trailing /* → /{wild*}
}

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

    // Keep `parse: false, output: 'stream'` so @axiomify/upload can pipe the
    // raw request into Busboy. JSON / urlencoded bodies are parsed per-request
    // below so handlers see a plain object on every adapter.
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

    // --- HAPI'S OWN ROUTER HANDLES ALL ROUTING ---
    // Each Axiomify route is registered with Hapi using the exact HTTP method
    // and a Hapi-format path. Hapi resolves the route, populates req.params,
    // and invokes the handler. Axiomify's internal router is NOT consulted in
    // the dispatch path — there is no double routing.
    for (const route of this.core.registeredRoutes) {
      const capturedRoute = route;
      const hapiPath = toHapiPath(route.path);

      this.server.route({
        method: route.method as Hapi.HTTP_METHODS_PARTIAL,
        path: hapiPath,
        handler: async (req: Hapi.Request, h: Hapi.ResponseToolkit) => {
          let parsedBody: unknown;
          try {
            parsedBody = await this.parseBody(req);
          } catch (err: unknown) {
            const anyErr = err as Record<string, unknown>;
            const statusCode =
              typeof anyErr.statusCode === 'number'
                ? anyErr.statusCode
                : typeof anyErr.status === 'number'
                  ? anyErr.status
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
                this.core.serializer({
                  data: null,
                  message,
                  statusCode,
                  isError: true,
                  req: axiomifyReq,
                }),
              )
              .code(statusCode);
          }

          return new Promise((resolve, reject) => {
            const axiomifyReq = this.translateRequest(req, parsedBody);
            const axiomifyRes = this.translateResponse(
              h,
              resolve,
              this.core.serializer,
              axiomifyReq,
            );

            // req.params is populated by Hapi's router — no re-routing.
            // Hapi uses {param} syntax internally; .params returns plain keys.
            this.core
              .handleMatchedRoute(
                axiomifyReq,
                axiomifyRes,
                capturedRoute,
                req.params as Record<string, string>,
              )
              .catch((err) => axiomifyRes.error(err));

            // Safety net when the core timeout is disabled (timeout=0).
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

    // 404 / 405 catch-all — Hapi exhausted its specific route table before
    // reaching this handler. Axiomify's router is consulted ONLY to distinguish
    // 405 from 404, never as a primary dispatch path.
    this.server.route({
      method: '*',
      path: '/{any*}',
      handler: async (req: Hapi.Request, h: Hapi.ResponseToolkit) => {
        const axiomifyReq = this.translateRequest(req, undefined);
        const headers: Record<string, string> = {};

        const match = this.core.router.lookup(
          req.method.toUpperCase() as never,
          req.path,
        );
        if (match && 'error' in match) {
          headers['Allow'] = match.allowed.join(', ');
          const payload = this.core.serializer({
            data: null,
            message: 'Method Not Allowed',
            statusCode: 405,
            isError: true,
            req: axiomifyReq,
          });
          const response = h.response(payload).code(405);
          response.header('Allow', match.allowed.join(', '));
          return response;
        }

        const payload = this.core.serializer({
          data: null,
          message: 'Route not found',
          statusCode: 404,
          isError: true,
          req: axiomifyReq,
        });
        return h.response(payload).code(404);
      },
    });
  }

  /**
   * Parses the request payload stream for non-multipart content types.
   * Multipart is left untouched so @axiomify/upload can drive it.
   * GET / HEAD / OPTIONS never have a body to parse.
   */
  private async parseBody(req: Hapi.Request): Promise<unknown> {
    const method = (req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return undefined;
    }

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) return undefined;

    const stream = req.payload as NodeJS.ReadableStream | undefined;
    if (!stream || typeof (stream as any).on !== 'function') return undefined;

    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;

      (stream as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > this.bodyLimitBytes) {
          (stream as any).destroy(
            Object.assign(new Error('Payload Too Large'), {
              statusCode: 413,
            }),
          );
          return;
        }
        chunks.push(chunk);
      });

      (stream as NodeJS.ReadableStream).on('end', () => {
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

      (stream as NodeJS.ReadableStream).on('error', reject);
    });
  }

  private translateRequest(
    req: Request,
    parsedBody: unknown,
  ): AxiomifyRequest {
    const _params: Record<string, string> = {};
    const _state: Record<string, unknown> = {};
    let _body: unknown = parsedBody;
    let _query: Record<string, string | string[]> = req.query as Record<string, string | string[]>;
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
      get method() { return req.method.toUpperCase() as AxiomifyRequest['method']; },
      get url() { return req.url.href; },
      get path() { return req.path; },
      get ip() { return req.info.remoteAddress; },
      get headers() { return req.headers as Record<string, string | string[] | undefined>; },
      get body() { return _body; },
      set body(val: unknown) { _body = val; },
      get query() { return _query; },
      set query(val: Record<string, string | string[]>) { _query = val; },
      get params() { return _params; },
      set params(val: Record<string, string>) { Object.assign(_params, val); },
      get state() { return _state; },
      get raw() { return req; },
      get stream() { return rawReq; },
      get signal() { return controller.signal; },
    };
  }

  private translateResponse(
    h: Hapi.ResponseToolkit,
    resolve: (val: Hapi.ResponseObject) => void,
    serializer: SerializerFn,
    req: AxiomifyRequest,
  ): AxiomifyResponse {
    let statusCode = 200;
    let isSent = false;
    let sseStream: PassThrough | null = null;
    const headers: Record<string, string> = {};

    const applyHeaders = (response: Hapi.ResponseObject) => {
      for (const [key, value] of Object.entries(headers)) {
        response.header(key, value);
      }
      return response;
    };

    const invoke = (input: Parameters<SerializerFn>[0]) =>
      serializer.length <= 1
        ? (serializer as (i: typeof input) => unknown)(input)
        : (serializer as Function)(
            input.data,
            input.message,
            input.statusCode,
            input.isError,
            input.req,
          );

    const self: AxiomifyResponse = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      header(key: string, value: string) {
        headers[key] = value;
        return this;
      },
      getHeader(key: string) {
        return headers[key];
      },
      removeHeader(key: string) {
        delete headers[key];
        return this;
      },
      send(data: unknown, message?: string) {
        if (isSent) return;
        isSent = true;
        const isError = statusCode >= 400;
        const payload = invoke({ data, message, statusCode, isError, req });
        resolve(applyHeaders(h.response(payload).code(statusCode)));
      },
      sendRaw(payload: unknown, contentType = 'text/plain') {
        if (isSent) return;
        isSent = true;
        headers['Content-Type'] = contentType;
        resolve(applyHeaders(h.response(payload as Hapi.ResponseValue).code(statusCode)));
      },
      error(err: unknown) {
        if (isSent) return;
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = invoke({
          data: null,
          message,
          statusCode: 500,
          isError: true,
          req,
        });
        resolve(applyHeaders(h.response(payload).code(500)));
      },
      stream(readable: Readable, contentType = 'application/octet-stream') {
        if (isSent) return;
        isSent = true;
        headers['Content-Type'] = contentType;
        resolve(applyHeaders(h.response(readable).code(statusCode)));
      },
      sseInit(sseHeartbeatMs = 15_000) {
        if (isSent) return;
        isSent = true;
        sseStream = new PassThrough();

        headers['Content-Type'] = 'text/event-stream';
        headers['Cache-Control'] = 'no-cache';
        headers['Connection'] = 'keep-alive';

        const heartbeat = setInterval(() => {
          sseStream!.write(': keepalive\n\n');
        }, sseHeartbeatMs);
        sseStream.on('close', () => clearInterval(heartbeat));

        resolve(applyHeaders(h.response(sseStream).code(200)));
      },
      sseSend(data: unknown, event?: string) {
        if (!sseStream) return;
        if (event) sseStream.write(`event: ${event}\n`);
        sseStream.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      get statusCode() {
        return statusCode;
      },
      get raw() {
        return h as unknown;
      },
      get headersSent() {
        return isSent;
      },
    };

    return self;
  }

  public async listen(port: number): Promise<void> {
    this.server.settings.port = port;
    await this.server.start();
  }

  public async close(): Promise<void> {
    await this.server.stop({ timeout: 10_000 });
  }
}

// Re-export AxiomifyResponse type for the private translateResponse method above.
import type { AxiomifyResponse } from '@axiomify/core';
