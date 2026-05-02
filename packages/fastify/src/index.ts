import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  SerializerFn,
} from '@axiomify/core';
import { sanitizeInput } from '@axiomify/core';
import crypto from 'crypto';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import { Readable } from 'stream';

function createRequestSignal(req: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('Client aborted request'));
    }
  };
  req.raw.once('aborted', abort);
  req.raw.once('close', () => {
    if (req.raw.destroyed) abort();
  });
  return controller.signal;
}

export interface FastifyAdapterOptions {
  /** Maximum body size in bytes. Default: Fastify's 1MB default. */
  bodyLimit?: number;
  /** Pass-through Fastify options for advanced cases. */
  fastifyOptions?: FastifyServerOptions;
}

export class FastifyAdapter {
  private app: FastifyInstance;

  constructor(private core: Axiomify, options: FastifyAdapterOptions = {}) {
    this.app = fastify({
      logger: false,
      bodyLimit: options.bodyLimit,
      ...options.fastifyOptions,
    });

    this.app.addContentTypeParser(
      'multipart/form-data',
      (_req, payload, done) => {
        done(null, payload);
      },
    );

    this.app.setErrorHandler((err, req, res) => {
      const anyErr = err as { statusCode?: number; status?: number };
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
      const axiomifyReq = this.translateRequest(req);
      const payload = this.core.serializer({
        data: null,
        message,
        statusCode,
        isError: true,
        req: axiomifyReq,
      });
      res.status(statusCode).send(payload);
    });

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
    const safeBody = sanitizeInput(req.body);
    const signal = createRequestSignal(req);

    // Compute path once at translation time. Avoids `new URL(...)` allocation
    // on every plugin access. Also handles protocol-relative paths like `//x`
    // that would mis-parse via URL().
    const queryIdx = req.url.indexOf('?');
    const path = queryIdx === -1 ? req.url : req.url.slice(0, queryIdx);

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
        return path;
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
      get signal() {
        return signal;
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
      getHeader(key: string) {
        const value = res.getHeader(key);
        return typeof value === 'string' ? value : undefined;
      },
      removeHeader(key: string) {
        res.removeHeader(key);
        return this;
      },

      send<T>(data: T, message = 'Operation successful') {
        if (isSent) return; // Idempotent: prevent double-write crashes.
        isSent = true;
        const isError = statusCode >= 400;
        const payload = serializer.length <= 1
          ? (serializer as any)({ data, message, statusCode, isError, req })
          : (serializer as any)(data, message, statusCode, isError, req);
        res.send(payload);
      },

      sendRaw(payload: any, contentType = 'text/plain') {
        if (isSent) return;
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(payload);
      },

      error(err: unknown) {
        if (isSent) return;
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = serializer.length <= 1
          ? (serializer as any)({
              data: null,
              message,
              statusCode: 500,
              isError: true,
              req,
            })
          : (serializer as any)(null, message, 500, true, req);
        res.status(500).send(payload);
      },

      stream(readable: Readable, contentType = 'application/octet-stream') {
        if (isSent) return;
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(readable);
      },

      sseInit(sseHeartbeatMs: number = 15_000) {
        if (isSent) return;
        isSent = true;
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const heartbeat = setInterval(() => {
          res.raw.write(': keepalive\n\n');
        }, sseHeartbeatMs);
        heartbeat.unref(); // Don't block process exit on a lingering SSE timer
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

  /**
   * Returns a Promise that resolves when the server is listening, or rejects
   * with the underlying error. Does NOT call process.exit on failure — callers
   * decide how to handle listen failures.
   */
  public async listen(port: number, callback?: () => void): Promise<void> {
    await this.app.listen({ port });
    callback?.();
  }

  public async close(): Promise<void> {
    await this.app.close();
  }
}
