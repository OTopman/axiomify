import type { Axiomify, AxiomifyRequest, SerializerFn } from '@axiomify/core';
import type { Request } from '@hapi/hapi';
import Hapi from '@hapi/hapi';
import crypto from 'crypto';
import { PassThrough, Readable } from 'stream';

export class HapiAdapter {
  private server: Hapi.Server;

  constructor(private core: Axiomify, config: Hapi.ServerOptions = {}) {
    // Merge the user configuration but force routes.payload options
    this.server = Hapi.server({
      ...config,
      routes: {
        ...(config.routes || {}),
        payload: {
          ...(config.routes?.payload || {}),
          output: 'stream',
          parse: false,
        },
      },
    });

    this.server.route({
      method: '*',
      path: '/{any*}',
      handler: (req: any, h: any) => {
        return new Promise((resolve, reject) => {
          const axiomifyReq = this.translateRequest(req);
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

          const effectiveTimeout = this.core.timeout || 30_000;
          if (effectiveTimeout > 0) {
            setTimeout(() => {
              if (!axiomifyRes.headersSent) {
                reject(
                  new Error(
                    `Axiomify handler did not send a response within the ${effectiveTimeout}ms timeout`,
                  ),
                );
              }
            }, effectiveTimeout).unref();
          }
        });
      },
    });
  }

  private translateRequest(req: Request): AxiomifyRequest {
    const _params = {};
    const _state = {};
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
        return req.payload;
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
        return req.raw.req;
      },
    };
  }

  private translateResponse(
    h: any,
    resolve: (val: any) => void,
    serializer: SerializerFn,
    req: AxiomifyRequest
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
