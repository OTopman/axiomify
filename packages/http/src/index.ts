import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  ResponseCapabilities,
  SerializerInput,
} from '@axiomify/core';
import { makeSerialize, sanitizeInput } from '@axiomify/core';
import cluster from 'cluster';
import type { IncomingMessage } from 'http';
import http from 'http';
import { cpus } from 'os';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Capabilities constant — allocated once for the entire adapter lifetime
// ---------------------------------------------------------------------------

const HTTP_CAPABILITIES: ResponseCapabilities = { sse: true, streaming: true };

// ---------------------------------------------------------------------------
// Per-process request ID counter — no crypto.randomUUID() on the hot path
// ---------------------------------------------------------------------------

let _httpCounter = 0;
const _httpPid = process.pid.toString(36);

// ---------------------------------------------------------------------------
// HttpRequest
//
// Three expensive operations are now LAZY (only computed when accessed):
//   1. id          — counter-based, not randomUUID(); only runs if accessed
//   2. query       — URLSearchParams construction skipped for routes that
//                    never read query params (e.g. POST handlers)
//   3. signal      — AbortController created only when the caller accesses
//                    req.signal; most handlers never need cancellation
//
// The previous eager approach paid all three costs unconditionally on every
// request, even when the handler never used them.
// ---------------------------------------------------------------------------

class HttpRequest implements AxiomifyRequest {
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly path: string;
  public readonly ip: string;
  public readonly headers: Record<string, string | string[] | undefined>;
  public readonly stream: Readable;
  public readonly raw: IncomingMessage;
  public readonly state: Record<string, unknown> = {};

  public body: unknown;
  public params: Record<string, string> = {};

  // Lazy backing fields — never accessed by the class itself directly
  private _id?: string;
  private _query?: Record<string, string | string[]>;
  private _controller?: AbortController;
  private _aborted = false;
  private readonly _queryStr: string;
  private readonly _rawReq: IncomingMessage;

  constructor(req: IncomingMessage, parsedBody: unknown, ip: string, sanitize: boolean) {
    const rawUrl = req.url ?? '/';
    const qIdx = rawUrl.indexOf('?');
    this.path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    this._queryStr = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);
    this.method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
    this.url = rawUrl;
    this.ip = ip;
    this.headers = req.headers as Record<string, string | string[] | undefined>;
    this.stream = req;
    this.raw = req;
    this._rawReq = req;
    this.body = sanitize && parsedBody !== undefined ? sanitizeInput(parsedBody) : parsedBody;

    // Wire up abort tracking cheaply — no AbortController yet.
    // The controller is only materialised if req.signal is accessed below.
    const onAbort = () => {
      this._aborted = true;
      this._controller?.abort(new Error('Client aborted request'));
    };
    req.once('aborted', onAbort);
    req.once('close', () => { if (req.destroyed) onAbort(); });
  }

  /** Lazy: computed once on first access, then cached. No crypto.randomUUID(). */
  get id(): string {
    if (this._id === undefined) {
      this._id =
        (this._rawReq.headers['x-request-id'] as string | undefined) ??
        `${_httpPid}-${(++_httpCounter).toString(36)}`;
    }
    return this._id;
  }

  /**
   * Lazy: URLSearchParams is only constructed when the caller reads query.
   * Routes that never access query params (common for POST/PUT handlers) pay
   * zero cost regardless of whether a query string is present in the URL.
   */
  get query(): Record<string, string | string[]> {
    if (this._query === undefined) {
      this._query = {};
      if (this._queryStr) {
        const sp = new URLSearchParams(this._queryStr);
        for (const key of new Set(sp.keys())) {
          const vals = sp.getAll(key);
          this._query[key] = vals.length === 1 ? vals[0] : vals;
        }
      }
    }
    return this._query;
  }

  /**
   * Lazy: AbortController is only created when the caller reads req.signal.
   * Handlers that do not perform cancellable async work never trigger the
   * AbortController allocation (~1 µs of V8 internal setup per request).
   */
  get signal(): AbortSignal {
    if (!this._controller) {
      this._controller = new AbortController();
      // If the request was already aborted before signal was first accessed,
      // abort immediately so the caller gets a pre-aborted signal.
      if (this._aborted) this._controller.abort(new Error('Client aborted request'));
    }
    return this._controller.signal;
  }
}

// ---------------------------------------------------------------------------
// HttpResponse
//
// send() no longer creates a SerializerInput object on every call.
// The _serializeInput bag is allocated once per response object and its
// properties are overwritten before each serializer call. This is safe
// because the serializer is always called synchronously.
// ---------------------------------------------------------------------------

class HttpResponse implements AxiomifyResponse {
  public statusCode = 200;
  public readonly capabilities: ResponseCapabilities = HTTP_CAPABILITIES;
  private _sent = false;
  private readonly _serializeInput: SerializerInput;

  constructor(
    private readonly _res: http.ServerResponse,
    private readonly _req: HttpRequest,
    private readonly _serialize: (input: SerializerInput) => unknown,
  ) {
    // Allocate the input bag once per response, not once per send().
    this._serializeInput = {
      data: undefined,
      message: undefined,
      statusCode: 200,
      isError: false,
      req: this._req,
    };
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(key: string, value: string): this {
    this._res.setHeader(key, value);
    return this;
  }

  getHeader(key: string): string | undefined {
    const v = this._res.getHeader(key);
    return typeof v === 'string' ? v : undefined;
  }

  removeHeader(key: string): this {
    this._res.removeHeader(key);
    return this;
  }

  send<T>(data: T, message?: string): void {
    if (this._sent) return;
    this._sent = true;
    const isError = this.statusCode >= 400;

    // Reuse the pre-allocated input object — no new allocation here.
    const input = this._serializeInput;
    input.data = data;
    input.message = message;
    input.statusCode = this.statusCode;
    input.isError = isError;

    let body: string;
    let finalCode = this.statusCode;
    try {
      body = JSON.stringify(this._serialize(input));
    } catch {
      finalCode = 500;
      body = '{"status":"failed","message":"Internal Server Error"}';
    }
    if (!this._res.hasHeader('Content-Type')) {
      this._res.setHeader('Content-Type', 'application/json');
    }
    this._res.writeHead(finalCode);
    this._res.end(body);
  }

  sendRaw(payload: unknown, contentType = 'text/plain'): void {
    if (this._sent) return;
    this._sent = true;
    this._res.setHeader('Content-Type', contentType);
    this._res.writeHead(this.statusCode);
    this._res.end(payload);
  }

  /**
   * @deprecated Use res.status(code).send(null, message) instead.
   * Will be removed in v5.
   */
  error(err: unknown): void {
    if (this._sent) return;
    const message = err instanceof Error ? err.message : 'Unknown Error';
    const statusCode = (err as Record<string, unknown>).statusCode as number ?? 500;
    this.status(statusCode).send(null, message);
  }

  stream(readable: Readable, contentType = 'application/octet-stream'): void {
    if (this._sent) return;
    this._sent = true;
    this._res.setHeader('Content-Type', contentType);
    this._res.writeHead(this.statusCode);
    readable.pipe(this._res);
  }

  sseInit(sseHeartbeatMs = 15_000): void {
    if (this._sent) return;
    this._sent = true;
    this._res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const heartbeat = setInterval(() => { this._res.write(': keepalive\n\n'); }, sseHeartbeatMs);
    heartbeat.unref();
    this._res.on('close', () => clearInterval(heartbeat));
  }

  sseSend(data: unknown, event?: string): void {
    if (event) this._res.write(`event: ${event}\n`);
    this._res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  get raw(): http.ServerResponse {
    return this._res;
  }

  get headersSent(): boolean {
    return this._sent;
  }
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface HttpAdapterOptions {
  bodyLimitBytes?: number;
  /**
   * When true, derive req.ip from the leftmost X-Forwarded-For entry,
   * falling back to socket.remoteAddress. Only enable behind a trusted
   * reverse proxy.
   */
  trustProxy?: boolean;
  /** Optional error sink for uncaught adapter-level errors. */
  onAdapterError?: (err: unknown) => void;
  /**
   * Number of worker processes for listenClustered().
   * Defaults to logical CPU count. Only set this higher than the number of
   * physical CPU cores when the workload is I/O-bound (not CPU-bound).
   */
  workers?: number;
  /**
   * When true, request bodies are recursively cloned to strip
   * prototype-pollution keys (__proto__, constructor, prototype).
   *
   * Default is false. JSON.parse in V8 does not produce objects that can
   * pollute Object.prototype from a valid JSON string — the actual attack
   * vector requires a naive merge function on the parsed object, which
   * Axiomify does not perform. Enable only if you merge req.body into other
   * objects using libraries that are known to be vulnerable.
   *
   * @default false
   */
  sanitize?: boolean;
  /**
   * Maximum time in milliseconds to wait for in-flight requests to drain
   * before a clustered worker force-exits after receiving SIGTERM.
   * @default 10000
   */
  gracefulTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// HttpAdapter
// ---------------------------------------------------------------------------

export class HttpAdapter {
  private server: http.Server;
  private readonly _trustProxy: boolean;
  private readonly _sanitize: boolean;
  private readonly _onAdapterError?: (err: unknown) => void;
  private readonly _workers: number;
  private readonly _gracefulTimeoutMs: number;
  /** Arity-normalised serializer — evaluated once at construction, not per request. */
  private readonly _serialize: (input: SerializerInput) => unknown;

  constructor(private readonly core: Axiomify, options: HttpAdapterOptions = {}) {
    this.core.lockRoutes('@axiomify/http');
    this._trustProxy = options.trustProxy ?? false;
    // Default sanitize is now false — see option docs above.
    this._sanitize = options.sanitize ?? false;
    this._onAdapterError = options.onAdapterError;
    this._workers = options.workers ?? cpus().length;
    this._gracefulTimeoutMs = options.gracefulTimeoutMs ?? 10_000;
    // makeSerialize is now imported from @axiomify/core — single source of truth.
    this._serialize = makeSerialize(this.core.serializer);

    this.server = http.createServer(async (req, res) => {
      try {
        const rawUrl = req.url ?? '/';
        const qIdx = rawUrl.indexOf('?');
        const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
        const method = (req.method ?? 'GET').toUpperCase();

        // Route lookup before body parsing — no work done for 404/405.
        const match = this.core.router.lookup(method as never, path);

        if (!match) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{"status":"failed","message":"Route not found"}');
          return;
        }

        if ('error' in match) {
          res.writeHead(405, {
            'Content-Type': 'application/json',
            Allow: match.allowed.join(', '),
          });
          res.end('{"status":"failed","message":"Method Not Allowed"}');
          return;
        }

        const parsedBody = await this._parseBody(req, options.bodyLimitBytes ?? 1_048_576);
        const ip = this._resolveIp(req);
        const axiomifyReq = new HttpRequest(req, parsedBody, ip, this._sanitize);
        const axiomifyRes = new HttpResponse(res, axiomifyReq, this._serialize);

        await this.core.handleMatchedRoute(axiomifyReq, axiomifyRes, match.route, match.params);
      } catch (err) {
        this._handleAdapterError(err);
        if (!res.headersSent) {
          const anyErr = err as Record<string, unknown>;
          const statusCode = typeof anyErr.statusCode === 'number' ? anyErr.statusCode : 500;
          const message =
            statusCode === 413 ? 'Payload Too Large'
            : statusCode === 400 ? 'Bad Request'
            : 'Internal Server Error';
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failed', message }));
        }
      }
    });
  }

  private _handleAdapterError(err: unknown): void {
    if (this._onAdapterError) { this._onAdapterError(err); return; }
    if (process.env.NODE_ENV !== 'production') {
      console.error('[axiomify/http] adapter error:', err);
    }
  }

  private _resolveIp(req: IncomingMessage): string {
    if (this._trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const value = Array.isArray(xff) ? xff[0] : xff;
      if (typeof value === 'string' && value.length > 0) {
        const first = value.split(',')[0]?.trim();
        if (first) return first;
      }
      const xri = req.headers['x-real-ip'];
      const xriValue = Array.isArray(xri) ? xri[0] : xri;
      if (typeof xriValue === 'string' && xriValue.length > 0) return xriValue;
    }
    return req.socket.remoteAddress ?? '0.0.0.0';
  }

  private async _parseBody(req: IncomingMessage, limitBytes = 1_048_576): Promise<unknown> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;

      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > limitBytes) {
          settled = true;
          req.resume();
          return reject(Object.assign(new Error('Payload Too Large'), { statusCode: 413 }));
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (settled) return;
        settled = true;
        if (chunks.length === 0) return resolve(undefined);
        const body = Buffer.concat(chunks).toString('utf8');
        const contentType = req.headers['content-type'] ?? '';
        try {
          resolve(JSON.parse(body));
        } catch {
          if (typeof contentType === 'string' && contentType.includes('application/json')) {
            return reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
          }
          resolve(body);
        }
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  public listen(port: number, callback?: () => void): http.Server {
    return this.server.listen(port, callback);
  }

  /**
   * Fork N worker processes and balance connections across them.
   *
   * KEY BEHAVIOURS vs the old implementation:
   *
   * 1. SO_REUSEPORT on Linux (cluster.SCHED_NONE + exclusive:true):
   *    Workers bind independently — no primary-mediated IPC round-trip per
   *    connection. On non-Linux the primary still distributes connections but
   *    the graceful drain semantics are identical.
   *
   * 2. Graceful SIGTERM drain:
   *    - Primary waits for ALL workers to exit before it exits.
   *    - Each worker stops accepting, closes idle keep-alives (Node 18.2+),
   *      then closes the server. A hard deadline force-exits after
   *      gracefulTimeoutMs if any request is still in flight.
   *    - Primary itself has a hard deadline (gracefulTimeoutMs + 2s) in case
   *      a worker hangs and never sends an exit event.
   *
   * 3. Exponential backoff on crash-restart:
   *    - Immediate respawn on first crash (100ms).
   *    - Doubles on each successive crash: 200ms → 400ms → ... → 5000ms cap.
   *    - Prevents a bad worker config from pinning a CPU in a tight restart loop.
   *
   * 4. readyCount is scoped to the initial spawn, not mutated by restarts:
   *    - onPrimary fires once when all initial workers are ready.
   *    - Restarted workers do not re-trigger onPrimary.
   *
   * WHEN DOES CLUSTERING ACTUALLY HELP?
   *   - @axiomify/http is single-threaded. Each additional worker on a separate
   *     physical CPU core adds genuine parallelism.
   *   - Set workers to the number of PHYSICAL cores, not logical (hyperthreaded)
   *     cores. Hyperthreading does not help for CPU-bound I/O dispatch.
   *   - On a 1 or 2 core machine, spawning 4+ workers HURTS — OS context
   *     switching overhead exceeds any parallelism gain.
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
      // On Linux: { exclusive: true } causes the kernel to give each worker its
      // own socket via SO_REUSEPORT, so connections are distributed at the kernel
      // level with no IPC round-trip. On other platforms this falls back to the
      // cluster module's normal (IPC-mediated) distribution.
      const listenTarget =
        process.platform === 'linux' ? { port, exclusive: true } : port;

      this.server.listen(listenTarget, () => {
        opts.onWorkerReady?.(port);
        process.send?.({ type: 'WORKER_READY', pid: process.pid });
      });

      process.once('SIGTERM', () => {
        // Immediately stop accepting new connections.
        // closeIdleConnections() (Node 18.2+) drops keep-alive sockets that
        // have no active request, letting server.close() resolve faster.
        if (typeof (this.server as any).closeIdleConnections === 'function') {
          (this.server as any).closeIdleConnections();
        }

        // Resolve when all active requests finish.
        this.server.close(() => process.exit(0));

        // Hard deadline: kill this worker if drain takes too long.
        // Unref so the timer does not itself prevent process exit.
        const deadline = setTimeout(() => {
          if (typeof (this.server as any).closeAllConnections === 'function') {
            (this.server as any).closeAllConnections();
          }
          process.exit(1);
        }, this._gracefulTimeoutMs);
        deadline.unref();
      });
      return;
    }

    // ── Primary ──────────────────────────────────────────────────────────

    // SO_REUSEPORT: on Linux, disable the round-robin IPC dispatcher so
    // workers bind independently. Each worker calls exclusive listen() above.
    if (process.platform === 'linux') {
      cluster.schedulingPolicy = cluster.SCHED_NONE;
    }

    const numWorkers = this._workers;
    const liveWorkers = new Map<number, cluster.Worker>();
    let readyCount = 0;
    let allReadyFired = false;

    const spawnWorker = (respawnDelayMs = 0): void => {
      setTimeout(() => {
        const w = cluster.fork();

        // PID is only guaranteed after 'online' on all platforms.
        w.once('online', () => {
          if (w.process.pid) liveWorkers.set(w.process.pid, w);
        });

        w.on('message', (msg: { type?: string }) => {
          if (msg?.type !== 'WORKER_READY') return;
          readyCount++;
          // Fire onPrimary exactly once — when the initial cohort is all ready.
          // Restarted workers increment readyCount but allReadyFired guards re-fire.
          if (!allReadyFired && readyCount >= numWorkers) {
            allReadyFired = true;
            opts.onPrimary?.([...liveWorkers.keys()]);
          }
        });

        w.on('exit', (code, signal) => {
          const pid = w.process.pid ?? 0;
          liveWorkers.delete(pid);
          opts.onWorkerExit?.(pid, code);
          // Intentional exits — do not restart.
          if (code === 0 || signal === 'SIGTERM') return;
          // Crash — restart with exponential backoff.
          // First restart: 100ms. Doubles each time, capped at 5s.
          // This prevents a misconfigured worker from spinning the CPU.
          const nextDelay = Math.min((respawnDelayMs || 50) * 2, 5_000);
          spawnWorker(nextDelay);
        });
      }, respawnDelayMs);
    };

    // SIGTERM: drain all workers gracefully, then exit the primary.
    // The primary does NOT exit immediately — it waits for every worker
    // to exit first. The old implementation called process.exit(0) right
    // after forwarding SIGTERM, orphaning workers mid-drain.
    process.once('SIGTERM', () => {
      if (liveWorkers.size === 0) { process.exit(0); return; }

      let pending = liveWorkers.size;
      for (const w of liveWorkers.values()) {
        w.once('exit', () => { if (--pending === 0) process.exit(0); });
        w.process.kill('SIGTERM');
      }

      // Hard deadline for the primary: exit after gracefulTimeoutMs + 2s
      // even if some workers have not exited. The +2s gives workers their
      // full gracefulTimeoutMs budget before the primary gives up.
      setTimeout(
        () => process.exit(1),
        this._gracefulTimeoutMs + 2_000,
      ).unref();
    });

    for (let i = 0; i < numWorkers; i++) spawnWorker();
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
