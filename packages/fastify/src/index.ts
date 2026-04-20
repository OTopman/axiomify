import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  SerializerFn,
} from '@axiomify/core';
import crypto from 'crypto';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { Readable } from 'stream';

/**
 * Strip prototype-pollution vectors from a parsed JSON body. Matches the
 * helpers in `@axiomify/http` and `@axiomify/express`. Without this, a body
 * like `{"__proto__": {"polluted": true}}` mutates Object.prototype.
 */
function sanitize(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype')
      continue;
    clean[key] = sanitize(obj[key]);
  }
  return clean;
}

export class FastifyAdapter {
  private app: FastifyInstance;

  constructor(private core: Axiomify) {
    this.app = fastify({ logger: false });

    this.app.addContentTypeParser(
      'multipart/form-data',
      (_req, payload, done) => {
        done(null, payload);
      },
    );

    // Fastify 5 / find-my-way 9 require the literal `/*`. The `/{*}` syntax
    // previously used is rejected with "Wildcard must be the last character
    // in the route" — the adapter couldn't instantiate at all.
    this.app.all('/*', async (req: FastifyRequest, res: FastifyReply) => {
      const axiomifyReq = this.translateRequest(req);
      const axiomifyRes = this.translateResponse(
        res,
        this.core.serializer,
        axiomifyReq,
      );

      await this.core.handle(axiomifyReq, axiomifyRes);
    });
  }

  private translateRequest(req: FastifyRequest): AxiomifyRequest {
    const _params = {};
    const _state = {};
    // Sanitize once at translation time rather than on every body access.
    const safeBody = sanitize(req.body);

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
        return new URL(`http://localhost${req.url}`).pathname;
      },
      get ip() {
        return req.ip;
      },
      get headers() {
        return req.headers as Record<string, string | string[] | undefined>;
      },
      get body() {
        return safeBody;
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
    serializer: SerializerFn,
    req: AxiomifyRequest,
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
        const isError = statusCode >= 400;
        isSent = true;
        const payload = serializer(data, message, statusCode, isError, req);
        res.send(payload);
      },
      sendRaw(payload: any, contentType = 'text/plain') {
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(payload);
      },
      error(err: unknown) {
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = serializer(null, message, 500, true, req);
        res.status(500).send(payload);
      },

      stream(readable: Readable, contentType = 'application/octet-stream') {
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(readable);
      },

      sseInit(sseHeartbeatMs: number = 15_000) {
        isSent = true;
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const heartbeat = setInterval(() => {
          res.raw.write(': keepalive\n\n');
        }, sseHeartbeatMs);
        res.raw.on('close', () => clearInterval(heartbeat));
      },

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

  public listen(port: number, callback?: () => void): void {
    this.app
      .listen({ port })
      .then(() => {
        callback?.();
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  }

  public async close(): Promise<void> {
    await this.app.close();
  }
}
