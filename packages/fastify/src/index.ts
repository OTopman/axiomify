import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  ResponseCapabilities,
  SerializerFn,
} from '@axiomify/core';
import { ADAPTER_LOCK_TOKEN, makeSerialize, sanitizeInput } from '@axiomify/core';
import cluster from 'cluster';
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import type { ListenOptions } from 'net';
import { availableParallelism } from 'os';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Capabilities — Fastify adapter supports both SSE and streaming
// ---------------------------------------------------------------------------

const FASTIFY_CAPABILITIES: ResponseCapabilities = {
  sse: true,
  streaming: true,
};

// ---------------------------------------------------------------------------
// Serializer arity: normalised once, not re-checked on every send()
// ---------------------------------------------------------------------------

// Per-process counter — avoids crypto.randomUUID() (~0.137µs) on every request.
let _fastifyCounter = 0;
const _fastifyPid = process.pid.toString(36);

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
  /**
   * When true, request bodies are recursively cloned to strip
   * prototype-pollution keys (default: false). JSON.parse in V8 does not produce
   * @default true
   */
  sanitize?: boolean;
}

// Maps Axiomify HTTP method to the Fastify instance method name.
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
  private readonly _sanitize: boolean;

  constructor(private core: Axiomify, options: FastifyAdapterOptions = {}) {
    console.warn(
      '[axiomify] The @axiomify/fastify adapter is deprecated and will be removed in v6. ' +
        "It routes all requests through Axiomify's own dispatcher, then re-wraps them for " +
        "fastify — adding overhead without any benefit from fastify's native performance. " +
        'Use @axiomify/http or @axiomify/native instead.',
    );
    this.core.lockRoutes(ADAPTER_LOCK_TOKEN, '@axiomify/fastify');
    this._workers = options.workers ?? availableParallelism();
    this._sanitize = options.sanitize ?? false;
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
        if (!body || body.length === 0) {
          done(null, undefined);
          return;
        }
        try {
          done(null, JSON.parse(body.toString('utf8')));
        } catch (e) {
          done(e as Error);
        }
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
        const axiomifyReq = this.translateRequest(req, this._sanitize);
        const axiomifyRes = this.translateResponse(
          reply,
          this.core.serializer,
          axiomifyReq,
        );
        const allow =
          (err as any).header?.Allow ?? reply.getHeader('Allow') ?? '';
        if (allow) axiomifyRes.header('Allow', allow as string);
        return axiomifyRes.status(405).send(null, 'Method Not Allowed');
      }

      const message =
        statusCode === 413
          ? 'Payload Too Large'
          : statusCode === 400
          ? 'Bad Request'
          : 'Internal Server Error';
      const axiomifyReq = this.translateRequest(req, this._sanitize);
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
          const axiomifyReq = this.translateRequest(req, this._sanitize);
          const axiomifyRes = this.translateResponse(
            reply,
            this.core.serializer,
            axiomifyReq,
          );
          // req.params is populated by Fastify's router — no re-routing.
          await this.core.handleMatchedRoute(
            ADAPTER_LOCK_TOKEN,
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
    this.app.setNotFoundHandler(
      async (req: FastifyRequest, reply: FastifyReply) => {
        const axiomifyReq = this.translateRequest(req, this._sanitize);
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
      },
    );
  }

  private translateRequest(
    req: FastifyRequest,
    sanitize = false,
  ): AxiomifyRequest {
    const queryIdx = req.url.indexOf('?');
    const path = queryIdx === -1 ? req.url : req.url.slice(0, queryIdx);

    // Lazy AbortController — only materialised when handler accesses .signal.
    let _controller: AbortController | undefined;
    let _aborted = false;
    const onAbort = () => {
      _aborted = true;
      _controller?.abort(new Error('Client aborted request'));
    };
    req.raw.once('aborted', onAbort);
    req.raw.once('close', () => {
      if (req.raw.destroyed) onAbort();
    });

    // Lazy id — avoids randomUUID() for handlers that never read req.id.
    let _id: string | undefined;

    return {
      get id(): string {
        if (!_id) {
          _id =
            (req.headers['x-request-id'] as string | undefined) ??
            req.id ??
            `${_fastifyPid}-${(++_fastifyCounter).toString(36)}`;
        }
        return _id;
      },
      method: req.method as AxiomifyRequest['method'],
      url: req.url,
      path,
      ip: req.ip,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body:
        sanitize && req.body !== undefined ? sanitizeInput(req.body) : req.body,
      query: req.query as Record<string, string | string[]>,
      params: {} as Record<string, string>,
      state: {} as Record<string, unknown>,
      raw: req,
      stream: req.raw,
      get signal(): AbortSignal {
        if (!_controller) {
          _controller = new AbortController();
          if (_aborted) _controller.abort(new Error('Client aborted request'));
        }
        return _controller.signal;
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

    // Cache arity once per response construction — not on every send().
    const invoke = makeSerialize(serializer);

    return {
      capabilities: FASTIFY_CAPABILITIES,

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
   *
   * In clustered mode, workers should not call this directly; listenClustered
   * handles socket binding with the correct reusePort / exclusive options.
   */
  public async listen(port: number, callback?: () => void): Promise<void> {
    await this.app.listen({ port, host: '0.0.0.0' });
    callback?.();
  }

  /**
   * Fork `workers` child processes and start Fastify on each.
   *
   * KEY BEHAVIOURS — fixed in this revision:
   *
   * 1. SO_REUSEPORT (Linux) / exclusive (other platforms):
   *    Workers bind their own socket via `reusePort: true` (Node ≥ 16.9) or
   *    `exclusive: true` (older Node). Without this, cluster falls back to
   *    SCHED_RR — the primary accepts every connection and forwards FDs via IPC,
   *    bottlenecking on a single-threaded accept() loop regardless of worker count.
   *
   * 2. SCHED_NONE before first fork:
   *    Required so worker listen() calls are not silently intercepted and
   *    routed back to the primary. Must be set before cluster.fork().
   *
   * 3. Crash circuit breaker:
   *    5+ crashes within 30 s → primary aborts. Prevents runaway respawn loops
   *    on broken config (missing env, failed migration, port already in use).
   *
   * 4. Graceful SIGTERM drain:
   *    Workers call fastify.close() which drains in-flight requests. Hard
   *    deadline force-exits after gracefulTimeoutMs to prevent hung handlers
   *    from blocking deployment forever.
   *
   * 5. SIGUSR2 rolling restart for zero-downtime reload:
   *    `kill -USR2 <primary-pid>` restarts workers one at a time, spacing
   *    each kill by gracefulTimeoutMs so a fresh replacement is always serving
   *    before the old one is terminated.
   */
  public listenClustered(
    port: number,
    opts: {
      onWorkerReady?: (port: number) => void;
      onPrimary?: (pids: number[]) => void;
      onWorkerExit?: (pid: number, code: number | null) => void;
      /** Max ms to wait for in-flight requests before force-exit. @default 10000 */
      gracefulTimeoutMs?: number;
    } = {},
  ): void {
    const gracefulTimeoutMs = opts.gracefulTimeoutMs ?? 10_000;

    // ── Worker ──────────────────────────────────────────────────────────────
    if (!cluster.isPrimary) {
      // Bind worker's own socket directly — bypasses cluster IPC dispatch.
      const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
      const listenOpts: ListenOptions =
        nodeMajor >= 16
          ? { port, host: '0.0.0.0', reusePort: true }
          : { port, host: '0.0.0.0', exclusive: true };

      this.app.listen(listenOpts).then(
        () => {
          opts.onWorkerReady?.(port);
          process.send?.({ type: 'WORKER_READY', pid: process.pid });
        },
        (err: Error) => {
          console.error(`[Axiomify/fastify] Worker ${process.pid} failed to bind port ${port}:`, err);
          process.exit(1);
        },
      );

      process.once('SIGTERM', () => {
        // close() drains in-flight requests then resolves.
        // Hard deadline prevents a hung handler from blocking forever.
        const deadline = setTimeout(() => process.exit(1), gracefulTimeoutMs);
        deadline.unref();
        this.close().finally(() => {
          clearTimeout(deadline);
          process.exit(0);
        });
      });
      return;
    }

    // ── Primary ─────────────────────────────────────────────────────────────

    // Must be set BEFORE the first cluster.fork() — frozen after first fork.
    // Required so worker reusePort/exclusive listen calls are not re-routed
    // through the primary by the cluster module.
    cluster.schedulingPolicy = cluster.SCHED_NONE;

    const numWorkers = this._workers;
    const parallelism = availableParallelism();
    if (numWorkers > parallelism) {
      console.warn(
        `[Axiomify/fastify] listenClustered: workers (${numWorkers}) > ` +
        `availableParallelism (${parallelism}). ` +
        `Oversubscription degrades throughput. ` +
        `Set workers: ${parallelism} or omit for the correct default.`,
      );
    }

    const liveWorkers = new Map<number, cluster.Worker>();
    let readyCount = 0;
    let allReadyFired = false;

    // Crash circuit breaker — 5 crashes within 30 s = abort.
    const CRASH_THRESHOLD = 5;
    const CRASH_WINDOW_MS = 30_000;
    const crashTimes: number[] = [];

    const spawnWorker = (respawnDelayMs = 0): void => {
      setTimeout(() => {
        const w = cluster.fork();
        w.once('online', () => {
          if (w.process.pid) liveWorkers.set(w.process.pid, w);
        });
        w.on('message', (msg: { type?: string }) => {
          if (msg?.type !== 'WORKER_READY') return;
          readyCount++;
          if (!allReadyFired && readyCount >= numWorkers) {
            allReadyFired = true;
            opts.onPrimary?.([...liveWorkers.keys()]);
          }
        });
        w.on('exit', (code, signal) => {
          const pid = w.process.pid ?? 0;
          liveWorkers.delete(pid);
          opts.onWorkerExit?.(pid, code);
          if (code === 0 || signal === 'SIGTERM') return;

          const now = Date.now();
          crashTimes.push(now);
          while (crashTimes.length && crashTimes[0] < now - CRASH_WINDOW_MS) crashTimes.shift();
          if (crashTimes.length >= CRASH_THRESHOLD) {
            console.error(
              `[Axiomify/fastify] ${crashTimes.length} workers crashed within ` +
              `${CRASH_WINDOW_MS}ms. Aborting to prevent runaway respawn loop.`,
            );
            process.exit(1);
          }

          spawnWorker(Math.min((respawnDelayMs || 50) * 2, 5_000));
        });
      }, respawnDelayMs);
    };

    // Primary waits for all workers to exit before exiting itself.
    process.once('SIGTERM', () => {
      if (liveWorkers.size === 0) {
        process.exit(0);
        return;
      }
      let pending = liveWorkers.size;
      for (const w of liveWorkers.values()) {
        w.once('exit', () => {
          if (--pending === 0) process.exit(0);
        });
        w.process.kill('SIGTERM');
      }
      setTimeout(() => process.exit(1), gracefulTimeoutMs + 2_000).unref();
    });

    // Zero-downtime rolling restart — kill -USR2 <primary-pid>.
    process.on('SIGUSR2', () => {
      const snapshot = [...liveWorkers.values()];
      if (snapshot.length === 0) return;
      let i = 0;
      const killNext = () => {
        if (i >= snapshot.length) return;
        const w = snapshot[i++];
        if (liveWorkers.has(w.process.pid ?? -1)) {
          w.process.kill('SIGTERM');
        }
        setTimeout(killNext, gracefulTimeoutMs);
      };
      killNext();
    });

    for (let i = 0; i < numWorkers; i++) spawnWorker();
  }

  public async close(): Promise<void> {
    await this.app.close();
  }
}
