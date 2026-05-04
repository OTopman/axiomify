import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  SerializerFn,
} from '@axiomify/core';
import { sanitizeInput } from '@axiomify/core';
import cluster from 'cluster';
import crypto from 'crypto';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import { cpus } from 'os';
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
  /** Maximum body size in bytes. Default: Fastify's 1 MiB default. */
  bodyLimit?: number;
  /** Pass-through Fastify options for advanced cases. */
  fastifyOptions?: FastifyServerOptions;
  /**
   * Number of worker processes for `listenClustered()`. Defaults to the
   * number of logical CPU cores.
   */
  workers?: number;
}

// Maps Axiomify HTTP method to the Fastify instance method name.
// Fastify exposes .delete() (not .del()), so no special casing needed.
const METHOD_MAP: Record<HttpMethod, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
  OPTIONS: 'options',
  HEAD: 'head',
};

export class FastifyAdapter {
  private app: FastifyInstance;
  private readonly _workers: number;

  constructor(private core: Axiomify, options: FastifyAdapterOptions = {}) {
    (this.core as any).lockRoutes?.('@axiomify/fastify');
    this._workers = options.workers ?? cpus().length;
    this.app = fastify({
      logger: false,
      bodyLimit: options.bodyLimit,
      ...options.fastifyOptions,
    });

    // Override Fastify's built-in JSON parser to make the body optional.
    // Without this, Fastify v5 rejects DELETE/HEAD requests that carry a
    // Content-Type: application/json header but no body with a 400 error,
    // which means those requests never reach a route handler or the
    // notFoundHandler for 405 detection.
    this.app.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body: Buffer, done) => {
        if (!body || body.length === 0) { done(null, undefined); return; }
        try { done(null, JSON.parse(body.toString('utf8'))); }
        catch (e) { done(e as Error); }
      },
    );

    // Pass multipart bodies through as raw streams so @axiomify/upload can
    // pipe them into Busboy directly.
    this.app.addContentTypeParser(
      'multipart/form-data',
      (_req, payload, done) => {
        done(null, payload);
      },
    );

    // Error handler for Fastify-level failures (413, body parse errors, 405, etc.)
    this.app.setErrorHandler((err, req, reply) => {
      const anyErr = err as { statusCode?: number; status?: number };
      const statusCode =
        typeof anyErr.statusCode === 'number'
          ? anyErr.statusCode
          : typeof anyErr.status === 'number'
            ? anyErr.status
            : 500;

      // Fastify sends 405 Method Not Allowed through the error handler, not
      // the notFoundHandler. Preserve the Allow header Fastify has already set.
      if (statusCode === 405) {
        const axiomifyReq = this.translateRequest(req);
        const axiomifyRes = this.translateResponse(reply, this.core.serializer, axiomifyReq);
        const allow = (err as any).header?.Allow ?? reply.getHeader('Allow') ?? '';
        if (allow) axiomifyRes.header('Allow', allow as string);
        return axiomifyRes.status(405).send(null, 'Method Not Allowed');
      }

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
      reply.status(statusCode).send(payload);
    });

    // --- FASTIFY'S OWN ROUTER HANDLES ALL ROUTING ---
    // Each Axiomify route is registered with Fastify's radix-trie router using
    // the exact HTTP method and path. Fastify resolves the route, extracts named
    // params, and invokes the handler. Axiomify's internal router is NOT used in
    // the dispatch path — there is no double routing.
    for (const route of this.core.registeredRoutes) {
      const fastifyMethod = METHOD_MAP[route.method];
      // Capture `route` in closure — critical to avoid sharing the last loop value.
      const capturedRoute = route;

      (this.app as unknown as Record<string, Function>)[fastifyMethod](
        route.path,
        async (req: FastifyRequest, reply: FastifyReply) => {
          const axiomifyReq = this.translateRequest(req);
          const axiomifyRes = this.translateResponse(
            reply,
            this.core.serializer,
            axiomifyReq,
          );
          // req.params is populated by Fastify's router — no re-routing.
          await this.core.handleMatchedRoute(
            axiomifyReq,
            axiomifyRes,
            capturedRoute,
            (req.params as Record<string, string>) ?? {},
          );
        },
      );
    }

    // 404 / 405 fallback — Fastify exhausted its own route table.
    // Axiomify's router is consulted ONLY to distinguish 405 from 404.
    this.app.setNotFoundHandler(async (req: FastifyRequest, reply: FastifyReply) => {
      const axiomifyReq = this.translateRequest(req);
      const axiomifyRes = this.translateResponse(
        reply,
        this.core.serializer,
        axiomifyReq,
      );
      const queryIdx = req.url.indexOf('?');
      const path = queryIdx === -1 ? req.url : req.url.slice(0, queryIdx);
      const match = this.core.router.lookup(req.method as HttpMethod, path);
      if (match && 'error' in match) {
        axiomifyRes.header('Allow', match.allowed.join(', '));
        return axiomifyRes.status(405).send(null, 'Method Not Allowed');
      }
      return axiomifyRes.status(404).send(null, 'Route not found');
    });
  }

  private translateRequest(req: FastifyRequest): AxiomifyRequest {
    const _params: Record<string, string> = {};
    const _state: Record<string, unknown> = {};
    let _body: unknown = sanitizeInput(req.body);
    let _query: Record<string, string | string[]> = req.query as Record<string, string | string[]>;
    const signal = createRequestSignal(req);

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
      get method() { return req.method as AxiomifyRequest['method']; },
      get url() { return req.url; },
      get path() { return path; },
      get ip() { return req.ip; },
      get headers() { return req.headers as Record<string, string | string[] | undefined>; },
      get body() { return _body; },
      set body(val: unknown) { _body = val; },
      get query() { return _query; },
      set query(val: Record<string, string | string[]>) { _query = val; },
      get params() { return _params; },
      set params(val: Record<string, string>) { Object.assign(_params, val); },
      get state() { return _state; },
      get raw() { return req; },
      get stream() { return req.raw; },
      get signal() { return signal; },
    };
  }

  private translateResponse(
    res: FastifyReply,
    serializer: SerializerFn,
    req: AxiomifyRequest,
  ): AxiomifyResponse {
    let statusCode = 200;
    let isSent = false;

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
        if (isSent) return;
        isSent = true;
        const isError = statusCode >= 400;
        const payload = invoke({ data, message, statusCode, isError, req });
        res.send(payload);
      },

      sendRaw(payload: unknown, contentType = 'text/plain') {
        if (isSent) return;
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(payload);
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
        res.status(500).send(payload);
      },

      stream(readable: Readable, contentType = 'application/octet-stream') {
        if (isSent) return;
        isSent = true;
        res.header('Content-Type', contentType);
        res.status(statusCode).send(readable);
      },

      sseInit(sseHeartbeatMs = 15_000) {
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
        heartbeat.unref();
        res.raw.on('close', () => clearInterval(heartbeat));
      },

      sseSend(data: unknown, event?: string) {
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
   * Resolves when the server is listening. Rejects with the underlying error
   * on bind failure — does NOT call process.exit.
   */
  public async listen(port: number, callback?: () => void): Promise<void> {
    await this.app.listen({ port });
    callback?.();
  }

  /**
   * Fork `workers` child processes and start Fastify on each. All workers
   * bind the same port via Node.js cluster's OS-level load balancing.
   *
   * @example
   * const adapter = new FastifyAdapter(app, { workers: 4 });
   * adapter.listenClustered(3000, {
   *   onWorkerReady: () => console.log(`[${process.pid}] Ready`),
   *   onPrimary: (pids) => console.log('Primary, workers:', pids),
   * });
   */
  public listenClustered(
    port: number,
    opts: {
      onWorkerReady?: (port: number) => void;
      onPrimary?: (pids: number[]) => void;
      onWorkerExit?: (pid: number, code: number | null) => void;
    } = {},
  ): void {
    if (!cluster.isPrimary) {
      this.listen(port, () => opts.onWorkerReady?.(port));
      return;
    }
    const numWorkers = this._workers;
    const pids: number[] = [];
    for (let i = 0; i < numWorkers; i++) {
      const w = cluster.fork();
      pids.push(w.process.pid ?? 0);
      w.on('exit', (code, signal) => {
        opts.onWorkerExit?.(w.process.pid ?? 0, code);
        if (code !== 0 && signal !== 'SIGTERM') {
          const r = cluster.fork();
          pids.push(r.process.pid ?? 0);
        }
      });
    }
    opts.onPrimary?.(pids);
  }

  public async close(): Promise<void> {
    await this.app.close();
  }
}
