import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import type { Request, ResponseToolkit, Server } from '@hapi/hapi';
import Hapi from '@hapi/hapi';
import crypto from 'crypto';

export class HapiAdapter {
  private server: Server;

  constructor(
    private core: Axiomify,
    config?: Hapi.ServerOptions,
  ) {
    this.server = Hapi.server(config || {});

    this.server.route({
      method: '*',
      path: '/{any*}',
      handler: async (req: Request, h: ResponseToolkit) => {
        return new Promise((resolve) => {
          const axiomifyReq = this.translateRequest(req);
          const axiomifyRes = this.translateResponse(h, resolve);

          this.core.handle(axiomifyReq, axiomifyRes).catch((err) => {
            axiomifyRes.error(err);
          });
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
    };
  }

  private translateResponse(
    h: ResponseToolkit,
    resolveCallback: (value: any) => void,
  ): AxiomifyResponse {
    let statusCode = 200;
    const headers: Record<string, string> = {};

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
      send<T>(data: T, message = 'Operation successful') {
        const isError = statusCode >= 400; // statusCode is tracked in the Hapi closure
        const response = h
          .response({ status: isError ? 'failed' : 'success', message, data })
          .code(statusCode);
        Object.entries(headers).forEach(([k, v]) => response.header(k, v));
        resolveCallback(response);
      },
      sendRaw(payload: any, contentType = 'text/plain') {
        headers['Content-Type'] = contentType;
        const response = h.response(payload).code(statusCode);
        Object.entries(headers).forEach(([k, v]) => response.header(k, v));
        resolveCallback(response);
      },
      error(err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const response = h
          .response({ status: 'failed', message, data: null })
          .code(500);
        resolveCallback(response);
      },
      get raw() {
        return h;
      },
    };
  }

  public async listen(port: number, callback?: () => void): Promise<void> {
    this.server.settings.port = port;
    await this.server.start();
    if (callback) callback();
  }
}
