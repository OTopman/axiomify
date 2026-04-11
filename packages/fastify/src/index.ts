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
import { Readable } from 'stream';

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
      const axiomifyRes = this.translateResponse(res, this.core.serializer);

      await this.core.handle(axiomifyReq, axiomifyRes);
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
      get stream() {
        return req.raw;
      },
    };
  }

  private translateResponse(
    res: FastifyReply,
    serializer: any,
  ): AxiomifyResponse {
    let statusCode = 200;
    let isSent = false;

    return {
      status(code: number) {
        statusCode = code;
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
        isSent = true;
        const payload = serializer(data, message, statusCode, isError);
        res.send(payload);
      },
      sendRaw(payload: any, contentType = 'text/plain') {
        res.header('Content-Type', contentType);
        res.status(statusCode).send(payload);
      },
      error(err: unknown) {
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = serializer(null, message, 500, true);
        res.status(500).send(payload);
      },

      stream(readable: Readable, contentType = 'application/octet-stream') {
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(readable);
      },

      // Fastify SSE Init
      sseInit() {
        isSent = true; // Mark as sent so Axiomify core doesn't timeout
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      },

      // Fastify SSE Send
      sseSend(data: any, event?: string) {
        if (event) res.raw.write(`event: ${event}\n`);
        res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      },

      get statusCode() {
        return statusCode;
      },

      get raw() {
        return res;
      },
      get headersSent() {
        return isSent;
      },
    };
  }

  public listen(
    port: number,
    callback?: (err: Error | null, address: string) => void,
  ): void {
    if (callback) {
      this.app.listen({ port }, callback);
    } else {
      this.app.listen({ port }).catch((err) => {
        console.error(err);
        process.exit(1);
      });
    }
  }

  public async close(): Promise<void> {
    await this.app.close();
  }
}
