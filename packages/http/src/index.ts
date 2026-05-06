import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  ResponseCapabilities,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { sanitizeInput } from '@axiomify/core';
import cluster from 'cluster';
import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import http from 'http';
import { cpus } from 'os';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Capabilities constant — HTTP adapter supports SSE and streaming
// ---------------------------------------------------------------------------

const HTTP_CAPABILITIES: ResponseCapabilities = { sse: true, streaming: true };

// ---------------------------------------------------------------------------
// Serializer arity: checked once per adapter construction, not per request
// ---------------------------------------------------------------------------

function makeSerialize(fn: SerializerFn): (input: SerializerInput) => unknown {
  if (fn.length <= 1) {
    return (input) => (fn as (i: SerializerInput) => unknown)(input);
  }
  return (input) =>
    (fn as Function)(
      input.data,
      input.message,
      input.statusCode,
      input.isError,
      input.req,
    );
}

// ---------------------------------------------------------------------------
// AbortSignal factory
// ---------------------------------------------------------------------------

function createRequestSignal(req: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('Client aborted request'));
    }
  };
  req.once('aborted', abort);
  req.once('close', () => {
    if (req.destroyed) abort();
  });
  return controller.signal;
}

// ---------------------------------------------------------------------------
// HttpRequest — plain-property class, no per-request closure allocation
// ---------------------------------------------------------------------------

class HttpRequest implements AxiomifyRequest {
  public readonly id: string;
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly path: string;
  public readonly ip: string;
  public readonly headers: Record<string, string | string[] | undefined>;
  public readonly stream: Readable;
  public readonly raw: IncomingMessage;
  public readonly signal: AbortSignal;
  public readonly state: Record<string, unknown> = {};

  public body: unknown;
  public params: Record<string, string> = {};
  public query: Record<string, string | string[]>;

  constructor(
    req: IncomingMessage,
    parsedBody: unknown,
    ip: string,
    sanitize: boolean,
  ) {
    const rawUrl = req.url ?? '/';
    const qIdx = rawUrl.indexOf('?');
    this.path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const queryStr = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);

    this.id =
      (req.headers['x-request-id'] as string | undefined) ??
      crypto.randomUUID();
    this.method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
    this.url = rawUrl;
    this.ip = ip;
    this.headers = req.headers as Record<string, string | string[] | undefined>;
    this.stream = req;
    this.raw = req;
    this.signal = createRequestSignal(req);
    this.body =
      sanitize && parsedBody !== undefined
        ? sanitizeInput(parsedBody)
        : parsedBody;

    // Multi-value query params: ?tag=a&tag=b -> { tag: ['a','b'] }
    const qOut: Record<string, string | string[]> = {};
    if (queryStr) {
      const sp = new URLSearchParams(queryStr);
      for (const key of new Set(sp.keys())) {
        const vals = sp.getAll(key);
        qOut[key] = vals.length === 1 ? vals[0] : vals;
      }
    }
    this.query = qOut;
  }
}

// ---------------------------------------------------------------------------
// HttpResponse — prototype-method class, no per-request closure allocation
// ---------------------------------------------------------------------------

class HttpResponse implements AxiomifyResponse {
  public statusCode = 200;
  public readonly capabilities: ResponseCapabilities = HTTP_CAPABILITIES;
  private _sent = false;

  constructor(
    private readonly _res: http.ServerResponse,
    private readonly _req: AxiomifyRequest,
    private readonly _serialize: (input: SerializerInput) => unknown,
  ) {}

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
    let body: string;
    let finalCode = this.statusCode;
    try {
      const payload = this._serialize({
        data,
        message,
        statusCode: this.statusCode,
        isError,
        req: this._req,
      });
      body = JSON.stringify(payload);
    } catch {
      finalCode = 500;
      body = JSON.stringify({
        status: 'failed',
        message: 'Internal Server Error',
      });
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

  error(err: unknown): void {
    if (this._sent) return;
    this._sent = true;
    const message = err instanceof Error ? err.message : 'Unknown Error';
    const payload = this._serialize({
      data: null,
      message,
      statusCode: 500,
      isError: true,
      req: this._req,
    });
    this._res.setHeader('Content-Type', 'application/json');
    this._res.writeHead(500);
    this._res.end(JSON.stringify(payload));
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
    const heartbeat = setInterval(() => {
      this._res.write(': keepalive\n\n');
    }, sseHeartbeatMs);
    // unref so a lingering SSE timer does not block process exit.
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
   * When true, derive `req.ip` from the leftmost `X-Forwarded-For` entry,
   * falling back to `socket.remoteAddress`. Only enable behind a trusted
   * reverse proxy.
   */
  trustProxy?: boolean;
  /** Optional error sink for uncaught adapter errors. */
  onAdapterError?: (err: unknown) => void;
  /**
   * Number of worker processes for `listenClustered()`. Defaults to the
   * number of logical CPU cores.
   */
  workers?: number;
  /**
   * When true (default), request bodies are recursively sanitized to strip
   * prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
   * Set to false only when bodies come from fully trusted sources or you
   * perform sanitization yourself.
   *
   * @default true
   */
  sanitize?: boolean;
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
  /** Arity-cached serializer — evaluated once, not per request. */
  private readonly _serialize: (input: SerializerInput) => unknown;

  constructor(private core: Axiomify, options: HttpAdapterOptions = {}) {
    // Use the public lockRoutes — no more casting to any.
    this.core.lockRoutes('@axiomify/http');
    this._trustProxy = options.trustProxy ?? false;
    this._sanitize = options.sanitize ?? true;
    this._onAdapterError = options.onAdapterError;
    this._workers = options.workers ?? cpus().length;
    this._serialize = makeSerialize(this.core.serializer);

    this.server = http.createServer(async (req, res) => {
      try {
        const rawUrl = req.url ?? '/';
        const qIdx = rawUrl.indexOf('?');
        const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
        const method = (req.method ?? 'GET').toUpperCase();

        // Single router lookup — result passed straight to handleMatchedRoute.
        const match = this.core.router.lookup(method as never, path);

        if (!match) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ status: 'failed', message: 'Route not found' }),
          );
          return;
        }

        if ('error' in match) {
          res.writeHead(405, {
            'Content-Type': 'application/json',
            Allow: match.allowed.join(', '),
          });
          res.end(
            JSON.stringify({ status: 'failed', message: 'Method Not Allowed' }),
          );
          return;
        }

        const parsedBody = await this._parseBody(
          req,
          options.bodyLimitBytes ?? 1_048_576,
        );
        const ip = this._resolveIp(req);
        const axiomifyReq = new HttpRequest(
          req,
          parsedBody,
          ip,
          this._sanitize,
        );
        const axiomifyRes = new HttpResponse(res, axiomifyReq, this._serialize);

        await this.core.handleMatchedRoute(
          axiomifyReq,
          axiomifyRes,
          match.route,
          match.params,
        );
      } catch (err) {
        this._handleAdapterError(err);
        if (!res.headersSent) {
          const anyErr = err as Record<string, unknown>;
          const statusCode =
            typeof anyErr.statusCode === 'number' ? anyErr.statusCode : 500;
          const message =
            statusCode === 413
              ? 'Payload Too Large'
              : statusCode === 400
              ? 'Bad Request'
              : 'Internal Server Error';
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failed', message }));
        }
      }
    });
  }

  private _handleAdapterError(err: unknown): void {
    if (this._onAdapterError) {
      this._onAdapterError(err);
      return;
    }
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

  private async _parseBody(
    req: IncomingMessage,
    limitBytes = 1_048_576,
  ): Promise<unknown> {
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
          return reject(
            Object.assign(new Error('Payload Too Large'), {
              statusCode: 413,
            }),
          );
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
          if (
            typeof contentType === 'string' &&
            contentType.includes('application/json')
          ) {
            return reject(
              Object.assign(new Error('Invalid JSON body'), {
                statusCode: 400,
              }),
            );
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
   * Fork `workers` child processes and start the server on each.
   *
   * Workers bind the port directly — bypassing the primary-mediated IPC
   * dispatch that Node.js cluster uses by default. The OS kernel load-
   * balances connections across workers via SO_REUSEPORT.
   *
   * SIGTERM is forwarded to all live workers for graceful drain. The
   * `onPrimary` callback fires only once ALL workers have signalled readiness
   * via IPC — not immediately after forking.
   *
   * @example
   * const adapter = new HttpAdapter(app);
   * adapter.listenClustered(3000, {
   *   onWorkerReady: (port) => console.log(`[${process.pid}] ready on ${port}`),
   *   onPrimary: (pids) => console.log('workers:', pids),
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
      // Worker: bind directly, notify primary on ready, handle SIGTERM.
      this.listen(port, () => {
        opts.onWorkerReady?.(port);
        process.send?.({ type: 'WORKER_READY', pid: process.pid });
      });
      process.once('SIGTERM', () => {
        this.close().finally(() => process.exit(0));
      });
      return;
    }

    // Primary: manage worker lifecycle.
    const numWorkers = this._workers;
    // Map prevents stale entries — dead PIDs are removed on exit.
    const liveWorkers = new Map<number, cluster.Worker>();
    let readyCount = 0;

    const spawnWorker = () => {
      const w = cluster.fork();

      // PID is only guaranteed available after 'online', not immediately
      // after fork() on all platforms.
      w.once('online', () => {
        if (w.process.pid) liveWorkers.set(w.process.pid, w);
      });

      w.on('message', (msg: { type?: string }) => {
        if (msg?.type === 'WORKER_READY') {
          readyCount++;
          if (readyCount === numWorkers) {
            // All workers ready — now safe to advertise the cluster.
            opts.onPrimary?.([...liveWorkers.keys()]);
          }
        }
      });

      w.on('exit', (code, signal) => {
        const pid = w.process.pid ?? 0;
        liveWorkers.delete(pid); // Remove stale entry immediately.
        opts.onWorkerExit?.(pid, code);
        // Restart on crash. Clean exit (code 0) or SIGTERM = intentional.
        if (code !== 0 && signal !== 'SIGTERM') spawnWorker();
      });
    };

    // Forward SIGTERM to all live workers before the primary exits.
    process.once('SIGTERM', () => {
      for (const w of liveWorkers.values()) w.process.kill('SIGTERM');
      process.exit(0);
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
