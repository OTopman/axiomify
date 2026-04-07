import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import crypto from 'crypto';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

export class FastifyAdapter {
  private app: FastifyInstance;

  constructor(private core: Axiomify) {
    this.app = fastify({ logger: false });

    // This allows the raw stream to reach Axiomify's Busboy engine
    this.app.addContentTypeParser('multipart/form-data', (_, payload, done) => {
      done(null, payload);
    });

    // Catch-all route to hijack traffic to the Axiomify Radix Engine
    this.app.all('/*', async (req: FastifyRequest, res: FastifyReply) => {
      const axiomifyReq = this.translateRequest(req);
      const axiomifyRes = this.translateResponse(res);

      await this.core.handle(axiomifyReq, axiomifyRes);

      // Fastify requires knowing when the async chain is done if we don't return directly
      return res;
    });
  }

  private translateRequest(req: FastifyRequest): AxiomifyRequest {
    const _params = {};
    const _state = {};
    return {
      get id() {
        return (
          (req.headers['x-request-id'] as string) ||
          req.id ||
          crypto.randomUUID()
        );
      },
      get method() {
        return req.method as AxiomifyRequest['method'];
      },
      get url() {
        return req.url;
      },
      get path() {
        return req.routerPath === '/*'
          ? new URL(`http://localhost${req.url}`).pathname
          : req.routerPath;
      },
      get ip() {
        return req.ip;
      },
      get headers() {
        return req.headers as Record<string, string | string[] | undefined>;
      },
      get body() {
        return req.body;
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

  private translateResponse(res: FastifyReply): AxiomifyResponse {
    return {
      status(code: number) {
        res.status(code);
        return this;
      },
      header(key: string, value: string) {
        res.header(key, value);
        return this;
      },
      removeHeader(key: string) {
        res.removeHeader(key);
        return this;
      },
      send<T>(data: T, message = 'Operation successful') {
        const isError = res.statusCode >= 400;
        res.send({ status: isError ? 'failed' : 'success', message, data });
      },
      sendRaw(payload: any, contentType = 'text/plain') {
        res.header('Content-Type', contentType);
        res.send(payload);
      },
      error(err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown Error';
        res.status(500).send({ status: 'failed', message, data: null });
      },
      get raw() {
        return res;
      },
    };
  }

  public listen(port: number, callback?: () => void): void {
    this.app.listen({ port, host: '0.0.0.0' }, (err) => {
      if (err) throw err;
      if (callback) callback();
    });
  }
}
