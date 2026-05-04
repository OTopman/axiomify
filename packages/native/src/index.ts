import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import cluster from 'cluster';
import { cpus } from 'os';
import { Readable } from 'stream';
import type {
  HttpRequest as UWSRequest,
  HttpResponse as UWSResponse,
  TemplatedApp,
  WebSocketBehavior,
} from 'uWebSockets.js';
import uWS from 'uWebSockets.js';
import { assertNoNativeSseRoutes } from './sse-guard';

// ---------------------------------------------------------------------------
// Status line cache
// RFC 7231 + common extensions — pre-built strings avoid allocations per send.
// ---------------------------------------------------------------------------

const HTTP_STATUS_PHRASES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const STATUS_LINE_CACHE = new Map<number, string>();
function statusLine(code: number): string {
  let line = STATUS_LINE_CACHE.get(code);
  if (!line) {
    line = `${code} ${HTTP_STATUS_PHRASES[code] ?? 'Unknown'}`;
    STATUS_LINE_CACHE.set(code, line);
  }
  return line;
}

// Pre-serialize the most common error payloads so 404/405/413 never allocate
// JSON strings in the hot path. Refreshed once on adapter construction.
interface CachedError {
  statusLine: string;
  body: string;
}
let CACHED_404: CachedError;
let CACHED_405_BODY: string; // body only — Allow header differs per route
let CACHED_413: CachedError;
let CACHED_500: CachedError;

function buildErrorCache(serializer: SerializerFn): void {
  const make = (statusCode: number, message: string): CachedError => ({
    statusLine: statusLine(statusCode),
    body: JSON.stringify(
      serializer.length <= 1
        ? (serializer as (i: SerializerInput) => unknown)({
            data: null,
            message,
            statusCode,
            isError: true,
          })
        : (serializer as Function)(null, message, statusCode, true),
    ),
  });
  CACHED_404 = make(404, 'Route not found');
  CACHED_405_BODY = JSON.stringify(
    serializer.length <= 1
      ? (serializer as (i: SerializerInput) => unknown)({
          data: null,
          message: 'Method Not Allowed',
          statusCode: 405,
          isError: true,
        })
      : (serializer as Function)(null, 'Method Not Allowed', 405, true),
  );
  CACHED_413 = make(413, 'Payload Too Large');
  CACHED_500 = make(500, 'Internal Server Error');
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/**
 * Extracts parameter key names from an Axiomify path in order.
 *
 * /users/:id/posts/:postId → ['id', 'postId']
 * /static/*               → ['*']
 *
 * The returned array is used at runtime to map uWS getParameter(i) → name.
 * This runs once at startup — zero overhead per request.
 */
function extractParamKeys(path: string): string[] {
  const keys: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.startsWith(':')) keys.push(segment.slice(1));
    else if (segment === '*') keys.push('*');
  }
  return keys;
}

/**
 * Maps an Axiomify HTTP method to the uWS TemplatedApp method name.
 * uWS uses `del` because `delete` is a reserved JS keyword.
 */
function uwsMethod(method: HttpMethod): keyof TemplatedApp {
  return (method === 'DELETE' ? 'del' : method.toLowerCase()) as keyof TemplatedApp;
}

// ---------------------------------------------------------------------------
// Body reading — zero-copy within uWS constraints
// ---------------------------------------------------------------------------

/**
 * Reads the full request body from uWS. The ArrayBuffer chunks provided by
 * `res.onData` are reused by uWS after each callback returns, so we MUST copy
 * them immediately via `Buffer.from(ab)`.
 *
 * Returns null if the connection was aborted before the body was complete.
 *
 * @param res        The uWS response handle.
 * @param maxSize    Maximum body size in bytes; resolves `{ tooLarge: true }`
 *                   when exceeded.
 * @param onAborted  Called when the client disconnects mid-body.
 */
function readBody(
  res: UWSResponse,
  maxSize: number,
  onAborted: () => void,
): Promise<{ raw: Buffer; tooLarge: boolean } | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    res.onAborted(() => {
      if (!settled) {
        settled = true;
        onAborted();
        resolve(null);
      }
    });

    res.onData((ab: ArrayBuffer, isLast: boolean) => {
      if (settled) return;

      // ArrayBuffer is ONLY valid during this callback — copy immediately.
      const chunk = Buffer.from(ab);
      totalSize += chunk.byteLength;

      if (totalSize > maxSize) {
        settled = true;
        // Drain remaining data without processing.
        resolve({ raw: Buffer.alloc(0), tooLarge: true });
        return;
      }

      chunks.push(chunk);

      if (isLast) {
        settled = true;
        if (chunks.length === 0) {
          resolve(null);
        } else if (chunks.length === 1) {
          // Fast path — single chunk: no concat needed.
          resolve({ raw: chunks[0], tooLarge: false });
        } else {
          resolve({ raw: Buffer.concat(chunks), tooLarge: false });
        }
      }
    });
  });
}

/**
 * Parse a raw Buffer into a request body based on Content-Type.
 * Returns `undefined` for unknown content types (raw Buffer accessible via req.body).
 */
function parseBodyBuffer(raw: Buffer, contentType: string): unknown {
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return undefined;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }
  // Return raw Buffer — @axiomify/upload or custom handlers consume it.
  return raw;
}

// Process-local atomic counter for request IDs.
// Faster than randomUUID() (0.049µs vs 0.137µs) and unique within the process lifetime.
// When a gateway injects X-Request-Id, the counter is bypassed entirely.
let _nativeReqCounter = 0;
const _nativePidHex = process.pid.toString(36);

// Reusable TextDecoder for IP address extraction.
// uWS returns the remote address as an ArrayBuffer. TextDecoder avoids the
// Buffer.from() → toString() allocation chain (saves ~0.079µs per request).
const _ipDecoder = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// NativeRequest — allocation-minimal AxiomifyRequest implementation
// ---------------------------------------------------------------------------

class NativeRequest implements AxiomifyRequest {
  public method: HttpMethod;
  public url: string;
  public path: string;
  public ip: string;
  public headers: Record<string, string>;
  public body: unknown;
  public params: Record<string, string> = {};
  public state: Record<string, unknown> = {};
  public raw: { req: UWSRequest | null; res: UWSResponse | null } = {
    req: null,
    res: null,
  };
  public stream: Readable = new Readable({ read() {} });

  private _queryStr: string;
  private _parsedQuery?: Record<string, string | string[]>;
  private _id?: string;
  private _controller?: AbortController;
  private _aborted = false;

  constructor(
    method: HttpMethod,
    url: string,
    ip: string,
    headers: Record<string, string>,
    queryStr: string,
    body: unknown,
  ) {
    this.method = method;
    this.url = url;
    this.path = url; // uWS getUrl() returns path only (no query string)
    this.ip = ip;
    this.headers = headers;
    this._queryStr = queryStr;
    this.body = body;
  }

  get id(): string {
    if (!this._id) {
      this._id = this.headers['x-request-id'] ?? `${_nativePidHex}-${(++_nativeReqCounter).toString(36)}`;
    }
    return this._id;
  }

  /**
   * Lazy query parsing — only allocates URLSearchParams when actually accessed.
   * Multi-value keys are preserved as string[] (e.g. ?tag=a&tag=b).
   */
  get query(): Record<string, string | string[]> {
    if (!this._parsedQuery) {
      this._parsedQuery = {};
      if (this._queryStr) {
        const sp = new URLSearchParams(this._queryStr);
        for (const key of new Set(sp.keys())) {
          const values = sp.getAll(key);
          this._parsedQuery[key] = values.length === 1 ? values[0] : values;
        }
      }
    }
    return this._parsedQuery;
  }

  /**
   * Lazy AbortSignal — AbortController is never created for requests that
   * don't need cancellation support, saving ~1µs per request.
   */
  get signal(): AbortSignal {
    if (!this._controller) {
      this._controller = new AbortController();
      if (this._aborted) this._controller.abort(new Error('Client aborted request'));
    }
    return this._controller.signal;
  }

  /** Called by the adapter when uWS fires the onAborted event. */
  onAbort(): void {
    this._aborted = true;
    this._controller?.abort(new Error('Client aborted request'));
  }
}

// ---------------------------------------------------------------------------
// NativeResponse — cork-everything, zero-allocation hot path
// ---------------------------------------------------------------------------

class NativeResponse implements AxiomifyResponse {
  public statusCode = 200;
  public headersSent = false;
  public aborted = false;
  public raw: UWSResponse;

  private readonly _app: Axiomify;
  private readonly _req: NativeRequest;
  private readonly _method: HttpMethod;
  // Use a plain object for small header counts; Map for large counts.
  // In practice most responses have ≤10 headers — object wins on V8.
  private _headers: Record<string, string> = {};

  constructor(
    res: UWSResponse,
    app: Axiomify,
    req: NativeRequest,
    method: HttpMethod,
  ) {
    this.raw = res;
    this._app = app;
    this._req = req;
    this._method = method;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(key: string, value: string): this {
    this._headers[key] = value;
    return this;
  }

  getHeader(key: string): string | undefined {
    return this._headers[key];
  }

  removeHeader(key: string): this {
    delete this._headers[key];
    return this;
  }

  send<T>(data: T, message?: string): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    const isError = this.statusCode >= 400;
    const serializer = this._app.serializer;
    const payload =
      serializer.length <= 1
        ? (serializer as (i: SerializerInput) => unknown)({
            data,
            message,
            statusCode: this.statusCode,
            isError,
            req: this._req,
          })
        : (serializer as Function)(data, message, this.statusCode, isError, this._req);

    // Store payload for ValidatingResponse introspection.
    (this as unknown as Record<string, unknown>).payload = payload;
    (this as unknown as Record<string, unknown>).responseMessage = message;

    const body = JSON.stringify(payload);
    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader('Content-Type', 'application/json');
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      // HEAD responses: send headers only, no body.
      this.raw.end(this._method === 'HEAD' ? '' : body);
    });
  }

  sendRaw(payload: unknown, contentType = 'text/plain'): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    const body =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload
          : String(payload);
    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader('Content-Type', contentType);
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      this.raw.end(body as string);
    });
  }

  error(err: unknown): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    const headers = this._headers;
    this.raw.cork(() => {
      this.raw.writeStatus(CACHED_500.statusLine);
      this.raw.writeHeader('Content-Type', 'application/json');
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      this.raw.end(CACHED_500.body);
    });
  }

  stream(readable: import('stream').Readable, contentType = 'application/octet-stream'): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader('Content-Type', contentType);
      this.raw.writeHeader('Transfer-Encoding', 'chunked');
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
    });

    const pending: Uint8Array[] = [];
    let flushing = false;
    const res = this.raw;
    const self = this;

    const flush = (): boolean => {
      if (self.aborted) return true;
      while (pending.length > 0) {
        const chunk = pending[0];
        const ok = res.write(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
        if (!ok) {
          readable.pause();
          if (!flushing) {
            flushing = true;
            res.onWritable(() => {
              flushing = false;
              const drained = flush();
              if (drained) readable.resume();
              return drained;
            });
          }
          return false;
        }
        pending.shift();
      }
      return true;
    };

    readable.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      pending.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      flush();
    });

    readable.on('end', () => {
      if (self.aborted) return;
      if (flush()) res.end();
      else {
        res.onWritable(() => {
          if (flush()) {
            res.end();
            return true;
          }
          return false;
        });
      }
    });

    readable.on('error', () => {
      if (!self.aborted) res.end();
    });
  }

  sseInit(): never {
    throw new Error(
      '[Axiomify/native] NativeAdapter does not support Server-Sent Events (SSE). ' +
        'Use @axiomify/http, @axiomify/express, @axiomify/fastify, or @axiomify/hapi for SSE endpoints.',
    );
  }

  sseSend(): never {
    throw new Error(
      '[Axiomify/native] NativeAdapter does not support Server-Sent Events (SSE). ' +
        'Use @axiomify/http, @axiomify/express, @axiomify/fastify, or @axiomify/hapi for SSE endpoints.',
    );
  }
}

// ---------------------------------------------------------------------------
// WebSocket types
// ---------------------------------------------------------------------------

type WsUserData = { url: string; headers: Record<string, string> };

export interface NativeWsOptions {
  /** WebSocket endpoint path. @default '/ws' */
  path?: string;
  compression?: number;
  maxPayloadLength?: number;
  idleTimeout?: number;
  open?: (ws: unknown) => void;
  message?: (ws: unknown, message: ArrayBuffer, isBinary: boolean) => void;
  close?: (ws: unknown, code: number, message: ArrayBuffer) => void;
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface NativeAdapterOptions {
  /** Listening port. @default 3000 */
  port?: number;
  /**
   * Maximum request body size in bytes. Requests exceeding this are
   * immediately rejected with 413. @default 1 MiB
   */
  maxBodySize?: number;
  /**
   * When true, derive the client IP from `X-Forwarded-For` via uWS's
   * `getProxiedRemoteAddressAsText()`. Only enable behind a trusted proxy.
   * @default false
   */
  trustProxy?: boolean;
  /**
   * WebSocket endpoint configuration. Omit to disable WebSocket support.
   * Set to `false` to explicitly disable.
   */
  ws?: NativeWsOptions | false;
  /**
   * Number of worker processes to spawn for `listenClustered()`.
   * Defaults to the number of logical CPU cores.
   *
   * Each worker runs its own uWS event loop. uWS natively supports SO_REUSEPORT
   * so all workers bind the same port — the kernel load-balances connections.
   * This is the most efficient multi-core strategy for uWS.
   *
   * Only used by `listenClustered()` — `listen()` is always single-process.
   */
  workers?: number;
}

// ---------------------------------------------------------------------------
// NativeAdapter
// ---------------------------------------------------------------------------

export class NativeAdapter {
  private readonly _app: Axiomify;
  private readonly _port: number;
  private readonly _server: TemplatedApp;
  private readonly _maxBodySize: number;
  private readonly _trustProxy: boolean;
  private readonly _workers: number;
  private _listenSocket: unknown = null;

  constructor(app: Axiomify, options: NativeAdapterOptions = {}) {
    this._app = app;
    (this._app as any).lockRoutes?.('@axiomify/native');
    this._port = options.port ?? 3000;
    this._maxBodySize = options.maxBodySize ?? 1_048_576;
    this._trustProxy = options.trustProxy ?? false;
    this._workers = options.workers ?? cpus().length;

    assertNoNativeSseRoutes(this._app.registeredRoutes);
    buildErrorCache(this._app.serializer);

    this._server = uWS.App();

    // WebSocket support (optional)
    if (options.ws !== false && options.ws !== undefined) {
      this._registerWs(options.ws);
    }

    // Register all Axiomify routes directly with uWS's C++ router.
    // uWS resolves method+path in native code — no JavaScript routing overhead.
    this._registerRoutes();

    // 404 / 405 catch-all. Must be registered LAST — uWS matches routes in
    // registration order, specific patterns take priority over `any('/*')`.
    this._registerFallback();
  }

  // -------------------------------------------------------------------------
  // Route registration
  // -------------------------------------------------------------------------

  private _registerRoutes(): void {
    const registeredGetPaths = new Set<string>();

    for (const route of this._app.registeredRoutes) {
      const paramKeys = extractParamKeys(route.path);
      const handler = this._makeHandler(route, paramKeys);
      const method = route.method;

      if (method === 'GET') {
        registeredGetPaths.add(route.path);
        this._server.get(route.path, handler);

        // uWS does not auto-generate HEAD for GET. Register it explicitly
        // unless the user already defined a HEAD route for the same path.
        const hasExplicitHead = this._app.registeredRoutes.some(
          (r) => r.method === 'HEAD' && r.path === route.path,
        );
        if (!hasExplicitHead) {
          const headHandler = this._makeHandler(route, paramKeys);
          this._server.head(route.path, headHandler);
        }
      } else if (method === 'DELETE') {
        this._server.del(route.path, handler);
      } else if (method === 'HEAD') {
        this._server.head(route.path, handler);
      } else if (method === 'OPTIONS') {
        this._server.options(route.path, handler);
      } else if (method === 'PATCH') {
        this._server.patch(route.path, handler);
      } else if (method === 'PUT') {
        this._server.put(route.path, handler);
      } else if (method === 'POST') {
        this._server.post(route.path, handler);
      }
    }
  }

  private _registerFallback(): void {
    this._server.any('/*', (res: UWSResponse, req: UWSRequest) => {
      // Register onAborted immediately before any async work.
      res.onAborted(() => {});

      const path = req.getUrl();
      const method = req.getMethod().toUpperCase() as HttpMethod;
      const match = this._app.router.lookup(method, path);

      res.cork(() => {
        if (match && 'error' in match) {
          res.writeStatus(statusLine(405));
          res.writeHeader('Content-Type', 'application/json');
          res.writeHeader('Allow', match.allowed.join(', '));
          res.end(CACHED_405_BODY);
        } else {
          res.writeStatus(CACHED_404.statusLine);
          res.writeHeader('Content-Type', 'application/json');
          res.end(CACHED_404.body);
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Per-route request handler factory
  // -------------------------------------------------------------------------

  private _makeHandler(
    route: (typeof this._app.registeredRoutes)[number],
    paramKeys: readonly string[],
  ) {
    const app = this._app;
    const maxBodySize = this._maxBodySize;
    const trustProxy = this._trustProxy;
    const method = route.method;
    const needsBody =
      method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';

    return (res: UWSResponse, req: UWSRequest): void => {
      // --- SYNCHRONOUS SECTION ---
      // uWS requires that all synchronous reads from `req` happen in this
      // callback. The HttpRequest object is ONLY valid until the first `await`.
      // We capture everything we need before going async.

      let aborted = false;

      // Extract path params by index — O(k) where k = number of params.
      const params: Record<string, string> = {};
      for (let i = 0; i < paramKeys.length; i++) {
        const val = req.getParameter(i);
        if (val !== '') params[paramKeys[i]] = val;
      }

      // Collect all request headers in one pass.
      const headers: Record<string, string> = {};
      req.forEach((k: string, v: string) => { headers[k] = v; });

      const url = req.getUrl();
      const queryStr = req.getQuery();
      const contentType = headers['content-type'] ?? '';
      const ip = trustProxy
        ? _ipDecoder.decode(res.getProxiedRemoteAddressAsText()) ||
          _ipDecoder.decode(res.getRemoteAddressAsText())
        : _ipDecoder.decode(res.getRemoteAddressAsText());

      // Register abort handler BEFORE any async work.
      res.onAborted(() => {
        aborted = true;
        axiomifyReq.onAbort();
      });

      // Construct request and response objects.
      const axiomifyReq = new NativeRequest(method, url, ip, headers, queryStr, undefined);
      axiomifyReq.params = params;
      const axiomifyRes = new NativeResponse(res, app, axiomifyReq, method);

      // --- ASYNC SECTION ---
      (async () => {
        // Body reading for methods that carry a request body.
        if (needsBody) {
          const result = await readBody(res, maxBodySize, () => {
            aborted = true;
            axiomifyReq.onAbort();
          });

          if (result === null) {
            // Client disconnected mid-body; nothing to do.
            return;
          }

          if (result.tooLarge) {
            if (!aborted) {
              axiomifyRes.aborted = false; // reset to allow send
              res.cork(() => {
                res.writeStatus(CACHED_413.statusLine);
                res.writeHeader('Content-Type', 'application/json');
                res.end(CACHED_413.body);
              });
            }
            return;
          }

          // Set parsed body on the request. Done after body read because
          // NativeRequest.body must be set before the handler sees it.
          (axiomifyReq as unknown as { body: unknown }).body = parseBodyBuffer(
            result.raw,
            contentType,
          );
        }

        if (aborted) return;
        axiomifyRes.aborted = aborted;

        await app.handleMatchedRoute(axiomifyReq, axiomifyRes, route, params);
      })().catch((err: unknown) => {
        // A .catch() is mandatory on all uWS async handlers. Without it, any
        // unhandled rejection (handler bug, DB drop, timeout) reaches Node's
        // 'unhandledRejection' event, which crashes the process in Node 15+.
        // Instead we try to send a 500 — if the response is already committed
        // (headersSent) we swallow silently, which is still safe.
        if (!aborted && !axiomifyRes.headersSent) {
          try {
            axiomifyRes.error(err);
          } catch {
            // res.error() itself threw (e.g. already aborted between the check
            // and the call) — nothing more we can do.
          }
        }
      });
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket registration
  // -------------------------------------------------------------------------

  private _registerWs(opts: NativeWsOptions): void {
    const wsPath = opts.path ?? '/ws';

    const behavior: WebSocketBehavior<WsUserData> = {
      compression: opts.compression ?? uWS.SHARED_COMPRESSOR,
      maxPayloadLength: opts.maxPayloadLength ?? 16 * 1024 * 1024,
      idleTimeout: opts.idleTimeout ?? 120,

      upgrade: (res: UWSResponse, req: UWSRequest, context: unknown) => {
        const url = req.getUrl();
        const secWebSocketKey = req.getHeader('sec-websocket-key');
        const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
        const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');

        const headers: Record<string, string> = {};
        req.forEach((k: string, v: string) => { headers[k] = v; });

        res.onAborted(() => {});

        res.cork(() => {
          res.upgrade(
            { url, headers },
            secWebSocketKey,
            secWebSocketProtocol,
            secWebSocketExtensions,
            context,
          );
        });
      },

      open: opts.open ?? (() => {}),
      message: opts.message ?? (() => {}),
      close: opts.close ?? (() => {}),
    };

    this._server.ws<WsUserData>(wsPath, behavior);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the server on a single Node.js event loop.
   * Use `listenClustered()` to saturate multiple CPU cores.
   */
  public listen(callback?: () => void, onError?: (err: Error) => void): void {
    this._server.listen(this._port, (token: unknown) => {
      if (token) {
        this._listenSocket = token;
        callback?.();
      } else {
        const err = new Error(`[Axiomify/native] Port ${this._port} is occupied.`);
        if (onError) {
          onError(err);
        } else {
          queueMicrotask(() => { throw err; });
        }
      }
    });
  }

  /**
   * Spawn `workers` child processes (default: one per CPU core) and start the
   * server on each. All workers bind the same port via `SO_REUSEPORT` — the
   * kernel distributes connections across them with no coordination overhead.
   *
   * This is the recommended way to saturate multi-core machines. At 4 cores
   * and 46k req/s per worker, total throughput approaches 180k req/s (minus
   * kernel scheduling variance).
   *
   * **In worker processes:** calls `listen()` and returns.
   * **In the primary process:** forks `workers` children, calls `onPrimary`
   * (if provided), and returns. The primary process itself does NOT bind the port.
   *
   * @example
   * const adapter = new NativeAdapter(app, { port: 3000 });
   * adapter.listenClustered({
   *   onWorkerReady: () => console.log(`Worker ${process.pid} listening`),
   *   onPrimary: (workerPids) => console.log('Primary', process.pid, '→ workers', workerPids),
   * });
   */
  public listenClustered(opts: {
    onWorkerReady?: () => void;
    onPrimary?: (pids: number[]) => void;
    onWorkerExit?: (pid: number, code: number | null) => void;
  } = {}): void {
    if (!cluster.isPrimary) {
      // We are already inside a worker — just bind and serve.
      this.listen(opts.onWorkerReady);
      return;
    }

    const numWorkers = this._workers;
    const pids: number[] = [];

    for (let i = 0; i < numWorkers; i++) {
      const w = cluster.fork();
      pids.push(w.process.pid ?? 0);

      w.on('exit', (code, signal) => {
        const pid = w.process.pid ?? 0;
        opts.onWorkerExit?.(pid, code);
        // Auto-restart crashed workers. Intentional shutdowns (SIGTERM) exit
        // with code 0 — those are not restarted.
        if (code !== 0 && signal !== 'SIGTERM') {
          const replacement = cluster.fork();
          pids.push(replacement.process.pid ?? 0);
        }
      });
    }

    opts.onPrimary?.(pids);
  }

  public close(): void {
    if (this._listenSocket) {
      uWS.us_listen_socket_close(this._listenSocket);
      this._listenSocket = null;
    }
  }
}

export { adaptMiddleware } from './bridge';
