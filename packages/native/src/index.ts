import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  ResponseCapabilities,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { ADAPTER_LOCK_TOKEN, makeSerialize } from '@axiomify/core';
import cluster from 'cluster';
import { cpus } from 'node:os';
import { availableParallelism } from 'os';
import { Readable } from 'stream';
import type {
  TemplatedApp,
  HttpRequest as UWSRequest,
  HttpResponse as UWSResponse,
  WebSocketBehavior,
} from 'uWebSockets.js';
import uWS from 'uWebSockets.js';


// ---------------------------------------------------------------------------
// Capabilities — native uWS adapter supports streaming but NOT SSE
// ---------------------------------------------------------------------------

const NATIVE_CAPABILITIES: ResponseCapabilities = {
  sse: false,
  streaming: true,
};

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
  // Use the same arity-normalizing helper so the ternary isn't repeated here.
  const serialize = makeSerialize(serializer);
  const make = (statusCode: number, message: string): CachedError => ({
    statusLine: statusLine(statusCode),
    body: JSON.stringify(
      serialize({ data: null, message, statusCode, isError: true }),
    ),
  });
  CACHED_404 = make(404, 'Route not found');
  CACHED_405_BODY = JSON.stringify(
    serialize({
      data: null,
      message: 'Method Not Allowed',
      statusCode: 405,
      isError: true,
    }),
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
  return (
    method === 'DELETE' ? 'del' : method.toLowerCase()
  ) as keyof TemplatedApp;
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

type WorkerState = 'STARTING' | 'READY' | 'DRAINING';
interface WorkerRecord {
  process: cluster.Worker;
  state: WorkerState;
}

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
  public params: Record<string, string> = Object.create(null);
  public state: Record<string, unknown> = {};
  public raw: { req: UWSRequest | null; res: UWSResponse | null } = {
    req: null,
    res: null,
  };
  public stream: Readable = new Readable({ read() { } });

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
      this._id =
        this.headers['x-request-id'] ??
        `${_nativePidHex}-${(++_nativeReqCounter).toString(36)}`;
    }
    return this._id;
  }

  /**
   * Lazy query parsing — only allocates URLSearchParams when actually accessed.
   * Multi-value keys are preserved as string[] (e.g. ?tag=a&tag=b).
   */
  get query(): Record<string, string | string[]> {
    if (!this._parsedQuery) {
      this._parsedQuery = Object.create(null) as Record<string, string | string[]>;
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
      if (this._aborted)
        this._controller.abort(new Error('Client aborted request'));
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
  public isStreaming = false;
  public onStreamClose: (() => void) | null = null;
  public raw: UWSResponse;
  public readonly capabilities: ResponseCapabilities = { ...NATIVE_CAPABILITIES, sse: true };
  public payload?: unknown;
  public responseMessage?: string;

  private readonly _app: Axiomify;
  private readonly _req: NativeRequest;
  private readonly _method: HttpMethod;
  private readonly _serialize: (input: SerializerInput) => unknown;
  // Use a plain object for small header counts; Map for large counts.
  // In practice most responses have ≤10 headers — object wins on V8.
  private _headers: Record<string, string> = {};
  // Pre-allocated serializer input bag — mutated in place on every send()
  // instead of allocating a new object per response. Safe because _serialize
  // is always called synchronously within send(), with no re-entrancy risk.
  private readonly _serializeInput: SerializerInput;

  constructor(
    res: UWSResponse,
    app: Axiomify,
    req: NativeRequest,
    method: HttpMethod,
    serialize: (input: SerializerInput) => unknown,
  ) {
    this.raw = res;
    this._app = app;
    this._req = req;
    this._method = method;
    this._serialize = serialize;
    this._serializeInput = {
      data: undefined,
      message: undefined,
      statusCode: 200,
      isError: false,
      req,
    };
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

    // Mutate the pre-allocated input bag rather than allocating a new object.
    // _serialize is always synchronous within this call — no re-entrancy risk.
    const inp = this._serializeInput;
    inp.data = data;
    inp.message = message;
    inp.statusCode = this.statusCode;
    inp.isError = this.statusCode >= 400;
    const payload = this._serialize(inp);

    // Store payload for ValidatingResponse introspection.
    this.payload = payload;
    this.responseMessage = message;

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

  stream(
    readable: import('stream').Readable,
    contentType = 'application/octet-stream',
  ): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;
    this.isStreaming = true;

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
      if (self.aborted) {
        readable.destroy();
        return true;
      }
      while (pending.length > 0) {
        const chunk = pending[0];
        const ok = res.write(
          chunk.buffer.slice(
            chunk.byteOffset,
            chunk.byteOffset + chunk.byteLength,
          ) as ArrayBuffer,
        );
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

    if (this._req.signal.aborted) {
      readable.destroy();
    } else {
      const abortListener = () => { readable.destroy(); };
      this._req.signal.addEventListener('abort', abortListener);
      readable.on('close', () => {
        this._req.signal.removeEventListener('abort', abortListener);
        self.onStreamClose?.();
      });
    }
  }

  private _pendingSse: string[] = [];
  private _flushingSse = false;

  sseInit(sseHeartbeatMs?: number): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader('Content-Type', 'text/event-stream');
      this.raw.writeHeader('Cache-Control', 'no-cache');
      this.raw.writeHeader('Connection', 'keep-alive');
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
    });

    if (sseHeartbeatMs) {
      const interval = setInterval(() => {
        this.sseSend(null, 'ping');
      }, sseHeartbeatMs);
      this._req.signal.addEventListener('abort', () => clearInterval(interval));
    }

    // Support onClose hooks similar to streams
    this.isStreaming = true;
    const abortListener = () => { this.onStreamClose?.(); };
    this._req.signal.addEventListener('abort', abortListener);
  }

  private _flushSse(): boolean {
    if (this.aborted) return true;
    const res = this.raw;
    while (this._pendingSse.length > 0) {
      const chunk = this._pendingSse[0];
      const ok = res.write(chunk);
      if (!ok) {
        if (!this._flushingSse) {
          this._flushingSse = true;
          res.onWritable(() => {
            this._flushingSse = false;
            return this._flushSse();
          });
        }
        return false;
      }
      this._pendingSse.shift();
    }
    return true;
  }

  sseSend(data: any, event?: string): void {
    if (this.aborted) return;
    if (!this.headersSent) {
      this.sseInit();
    }

    let payload = '';
    if (event) {
      payload += `event: ${event}\n`;
    }
    if (data !== undefined && data !== null) {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      const lines = serialized.split('\n');
      for (const line of lines) {
        payload += `data: ${line}\n`;
      }
    }
    payload += '\n';

    this._pendingSse.push(payload);
    this._flushSse();
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
  /**
   * Opt-in to the userspace L4 TCP proxy used by `listenClustered()` on
   * non-Linux platforms (macOS, Windows). uWS's `SO_REUSEPORT` clustering is
   * Linux-only; on other platforms the primary process must proxy traffic to
   * worker processes in userspace, which adds two event-loop hops per byte
   * and roughly negates the perf benefit of using uWS in the first place.
   *
   * `listenClustered()` will THROW on non-Linux unless this flag is `true`.
   * Set it explicitly only if you understand the tradeoff. On Linux this
   * flag is ignored.
   *
   * @default false
   */
  allowUserspaceProxy?: boolean;
  /**
   * Optional structured logger for adapter-level warnings (userspace proxy
   * activation, worker respawn, etc.). Falls back to `console` when omitted.
   */
  logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
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
  private readonly _allowUserspaceProxy: boolean;
  private readonly _logger: NonNullable<NativeAdapterOptions['logger']>;
  /** Serializer arity cached at construction time — not re-checked per request. */
  private readonly _serialize: (input: SerializerInput) => unknown;
  private _listenSocket: unknown = null;
  private _onShutdown?: () => void | Promise<void>;

  constructor(app: Axiomify, options: NativeAdapterOptions = {}) {
    this._app = app;
    this._app.lockRoutes(ADAPTER_LOCK_TOKEN, '@axiomify/native');
    this._port = options.port ?? 3000;
    this._maxBodySize = options.maxBodySize ?? 1_048_576;
    this._trustProxy = options.trustProxy ?? false;
    this._workers = options.workers ?? availableParallelism();
    this._allowUserspaceProxy = options.allowUserspaceProxy ?? false;
    this._logger = options.logger ?? {
      warn: (msg, meta) => console.warn(msg, meta ?? ''),
      error: (msg, meta) => console.error(msg, meta ?? ''),
    };
    this._serialize = makeSerialize(this._app.serializer);

    buildErrorCache(this._app.serializer);

    this._server = uWS.App();

    // WebSocket support (optional)
    if (options.ws !== false && options.ws !== undefined) {
      this._registerWs(options.ws);
    }

    // Register all Axiomify routes directly with uWS's C++ router.
    // uWS resolves method+path in native code — no JavaScript routing overhead.
    this._registerWsRoutes();
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
      res.onAborted(() => { });
      res.cork(() => {
        res.writeStatus(CACHED_404.statusLine);
        res.writeHeader('Content-Type', 'application/json');
        res.end(CACHED_404.body);
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
    const serialize = this._serialize; // captured once per route, not per request
    const method = route.method;
    const needsBody =
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE';

    return (res: UWSResponse, req: UWSRequest): void => {
      // --- SYNCHRONOUS SECTION ---
      // uWS requires that all synchronous reads from `req` happen in this
      // callback. The HttpRequest object is ONLY valid until the first `await`.
      // We capture everything we need before going async.

      let aborted = false;

      // Extract path params by index — O(k) where k = number of params.
      const params: Record<string, string> = Object.create(null);
      for (let i = 0; i < paramKeys.length; i++) {
        const val = req.getParameter(i);
        if (val !== '') params[paramKeys[i]] = val;
      }

      // Collect all request headers in one pass.
      const headers: Record<string, string> = {};
      req.forEach((k: string, v: string) => {
        headers[k] = v;
      });

      const url = req.getUrl();
      const queryStr = req.getQuery();
      const contentType = headers['content-type'] ?? '';
      const ip = trustProxy
        ? _ipDecoder.decode(res.getProxiedRemoteAddressAsText()) ||
        _ipDecoder.decode(res.getRemoteAddressAsText())
        : _ipDecoder.decode(res.getRemoteAddressAsText());

      // Construct request and response objects.
      const axiomifyReq = new NativeRequest(
        method,
        url,
        ip,
        headers,
        queryStr,
        undefined,
      );
      axiomifyReq.params = params;
      const axiomifyRes = new NativeResponse(
        res,
        app,
        axiomifyReq,
        method,
        serialize,
      );

      // Register abort handler BEFORE any async work.
      res.onAborted(() => {
        aborted = true;
        axiomifyReq.onAbort();
        axiomifyRes.aborted = true;
      });

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

        await app.handleMatchedRoute(ADAPTER_LOCK_TOKEN, axiomifyReq, axiomifyRes, route, params);
      })().catch((err: unknown) => {
        // A .catch() is mandatory on all uWS async handlers. Without it, any
        // unhandled rejection (handler bug, DB drop, timeout) reaches Node's
        // 'unhandledRejection' event, which crashes the process in Node 15+.
        // Instead we try to send a 500 — if the response is already committed
        // (headersSent) we swallow silently, which is still safe.
        if (!aborted && !axiomifyRes.headersSent) {
          try {
            // Do NOT use axiomifyRes.error(err) — that deprecated method always
            // sends 500 and does not respect err.statusCode. Inline the same
            // logic used by RequestDispatcher.handleError so HTTP error status
            // codes thrown by handlers are preserved.
            const anyErr = err as Record<string, unknown>;
            const errStatus =
              typeof anyErr.statusCode === 'number'
                ? anyErr.statusCode
                : typeof anyErr.status === 'number'
                  ? anyErr.status
                  : 500;
            const errMsg =
              typeof anyErr.message === 'string'
                ? anyErr.message
                : 'Internal Server Error';
            axiomifyRes.status(errStatus).send(null, errMsg);
          } catch {
            // axiomifyRes.send() itself threw (e.g. already aborted between the
            // check and the call) — nothing more we can do.
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
        const secWebSocketExtensions = req.getHeader(
          'sec-websocket-extensions',
        );

        const headers: Record<string, string> = {};
        req.forEach((k: string, v: string) => {
          headers[k] = v;
        });

        res.onAborted(() => { });

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

      open: opts.open ?? (() => { }),
      message: opts.message ?? (() => { }),
      close: opts.close ?? (() => { }),
    };

    this._server.ws<WsUserData>(wsPath, behavior);
  }

  private _registerWsRoutes(): void {
    const validator = this._app.validator;
    const trustProxy = this._trustProxy;

    for (const route of this._app.registeredWsRoutes) {
      const paramKeys = extractParamKeys(route.path);
      const routeId = `WS:${route.path}`;

      const behavior: WebSocketBehavior<any> = {
        compression: uWS.SHARED_COMPRESSOR,
        maxPayloadLength: 16 * 1024 * 1024,
        idleTimeout: 120,

        upgrade: (res: UWSResponse, req: UWSRequest, context: unknown) => {
          let aborted = false;

          const params: Record<string, string> = Object.create(null);
          for (let i = 0; i < paramKeys.length; i++) {
            const val = req.getParameter(i);
            if (val !== '') params[paramKeys[i]] = val;
          }

          const headers: Record<string, string> = {};
          req.forEach((k: string, v: string) => {
            headers[k] = v;
          });

          const url = req.getUrl();
          const queryStr = req.getQuery();
          const ip = trustProxy
            ? _ipDecoder.decode(res.getProxiedRemoteAddressAsText()) ||
            _ipDecoder.decode(res.getRemoteAddressAsText())
            : _ipDecoder.decode(res.getRemoteAddressAsText());

          const secWebSocketKey = headers['sec-websocket-key'];
          const secWebSocketProtocol = headers['sec-websocket-protocol'];
          const secWebSocketExtensions = headers['sec-websocket-extensions'];

          const axiomifyReq = new NativeRequest(
            'GET',
            url,
            ip,
            headers,
            queryStr,
            undefined,
          );
          axiomifyReq.params = params;
          const axiomifyRes = new NativeResponse(res, this._app, axiomifyReq, 'GET', this._serialize);

          res.onAborted(() => {
            aborted = true;
            axiomifyReq.onAbort();
            axiomifyRes.aborted = true;
          });

          (async () => {
            // Run onRequest hooks (security, CORS, request-ID, etc.)
            const onRequestRet = this._app.hooks.run('onRequest', axiomifyReq, axiomifyRes);
            if (onRequestRet) await onRequestRet;
            if (axiomifyRes.headersSent || aborted) return;

            // Run onPreHandler hooks (rate-limit, auth plugins, etc.)
            const onPreHandlerRet = this._app.hooks.run('onPreHandler', axiomifyReq, axiomifyRes, { route: route as any, params });
            if (onPreHandlerRet) await onPreHandlerRet;
            if (axiomifyRes.headersSent || aborted) return;

            // Route-level plugins
            if (route.plugins) {
              for (const plugin of route.plugins) {
                if (axiomifyRes.headersSent || aborted) break;
                const ret = plugin(axiomifyReq, axiomifyRes);
                if (ret instanceof Promise) await ret;
              }
            }
            if (axiomifyRes.headersSent || aborted) return;

            res.upgrade({ state: axiomifyReq.state, req: axiomifyReq }, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, context);
          })().catch((err: unknown) => {
            if (!aborted && !axiomifyRes.headersSent) {
              const e = err as Record<string, unknown>;
              axiomifyRes
                .status(typeof e.statusCode === 'number' ? e.statusCode : 500)
                .send(null, typeof e.message === 'string' ? e.message : 'Internal Server Error');
            }
          });
        },

        open: (ws: any) => {
          const client = {
            state: ws.state,
            send: (message: any, isBinary?: boolean) => {
              const data = typeof message === 'string' || Buffer.isBuffer(message) ? message : JSON.stringify(message);
              ws.send(data, isBinary);
            },
            close: () => ws.close(),
            subscribe: (topic: string) => ws.subscribe(topic),
            unsubscribe: (topic: string) => ws.unsubscribe(topic),
            publish: (topic: string, message: any, isBinary?: boolean) => {
              const data = typeof message === 'string' || Buffer.isBuffer(message) ? message : JSON.stringify(message);
              ws.publish(topic, data, isBinary);
            }
          };
          ws.client = client;
          if (route.open) {
            route.open(client, ws.req);
          }
        },

        message: (ws: any, message: ArrayBuffer, isBinary: boolean) => {
          if (route.message) {
            const data = Buffer.from(message);
            let parsedData: any = data;

            if (route.schema?.message) {
              const asStr = data.toString('utf8');
              try {
                parsedData = JSON.parse(asStr);
              } catch {
                parsedData = asStr;
              }
              try {
                validator.execute(routeId + ':message', { body: parsedData } as any);
              } catch (err: unknown) {
                const isProduction = process.env.NODE_ENV === 'production';
                ws.client.send(
                  isProduction
                    ? { error: 'Invalid message' }
                    : { error: 'Invalid message', details: (err as any).errors }
                );
                return;
              }
            }

            route.message(ws.client, parsedData);
          }
        },

        close: (ws: any, code: number, message: ArrayBuffer) => {
          if (route.close) {
            route.close(ws.client, code, Buffer.from(message).toString('utf8'));
          }
        },

        drain: (ws: any) => {
          if (route.drain) route.drain(ws.client);
        }
      };

      this._server.ws<any>(route.path, behavior);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the server on a single Node.js event loop.
   * Use `listenClustered()` to saturate multiple CPU cores.
   */
  public listen(
    callback?: (port: number) => void,
    onError?: (err: Error) => void,
    portOverride?: number,
  ): void {
    const port = portOverride ?? this._port;
    this._server.listen(port, (token: unknown) => {
      if (token) {
        this._listenSocket = token;
        this._installCrashGuard();
        callback?.((uWS as any).us_socket_local_port(token));
      } else {
        const err = new Error(
          `[Axiomify/native] Port ${this._port} is occupied.`,
        );
        if (onError) {
          onError(err);
        } else {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    });
  }

  /**
   * Installs process-level crash guards that close the uWS listen socket
   * on any fatal exit path (uncaught exception, unhandled rejection, SIGINT,
   * SIGTERM). Without this, a crash leaves the port in TIME_WAIT and the
   * process cannot restart on the same port immediately.
   *
   * Guards are installed exactly once per adapter instance and are idempotent
   * — calling `close()` multiple times is safe.
   *
   * The signal handlers installed here are stored on the instance so
   * `gracefulShutdown()` can detach them and take ownership of SIGINT/SIGTERM,
   * regardless of which method the caller invokes first.
   */
  private _crashGuardInstalled = false;
  private _crashSignalHandlers: { sig: 'SIGINT' | 'SIGTERM'; fn: () => void }[] = [];
  private _installCrashGuard(): void {
    if (this._crashGuardInstalled) return;
    this._crashGuardInstalled = true;

    const cleanup = () => this.close();

    // 'exit' is the last chance — runs synchronously, no async allowed.
    process.once('exit', cleanup);

    // If gracefulShutdown() already claimed signal ownership, stop here —
    // the 'exit' guard above still runs if anything else kills the process.
    if (this._onShutdown !== undefined) return;

    // Interactive stop (Ctrl+C) and orchestrator signals.
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const fn = () => {
        cleanup();
        process.exit(0);
      };
      this._crashSignalHandlers.push({ sig, fn });
      process.once(sig, fn);
    }
  }

  /**
   * Spawn `workers` child processes (default: one per CPU core) and start the
   * server on each. All workers bind the same port directly via uWS's
   * `SO_REUSEPORT` — the kernel load-balances connections with no IPC overhead.
   *
   * SIGTERM is forwarded to all live workers for graceful drain. `onPrimary`
   * fires only once ALL workers have signalled readiness — not immediately
   * after forking.
   *
   * @example
   * const adapter = new NativeAdapter(app, { port: 3000 });
   * adapter.listenClustered({
   *   onWorkerReady: () => console.log(`Worker ${process.pid} listening`),
   *   onPrimary: (pids) => console.log('Primary', process.pid, '→ workers', pids),
   * });
   */
  /* v8 ignore start -- clustering requires real OS process forking */
  public listenClustered(
    opts: {
      onWorkerReady?: () => void;
      onPrimary?: (pids: number[]) => void;
      onWorkerExit?: (pid: number, code: number | null) => void;
      gracefulTimeoutMs?: number;
    } = {},
  ): void {
    const gracefulTimeoutMs = opts.gracefulTimeoutMs ?? 10_000;
    const isLinux = process.platform === 'linux';

    // ── Platform gate ───────────────────────────────────────────────────
    // uWS's SO_REUSEPORT clustering only works on Linux. On macOS/Windows we
    // would fall back to a userspace L4 proxy that defeats the perf rationale
    // of using uWS in the first place. Require an explicit opt-in so users
    // discover the tradeoff at boot, not in production under load.
    if (!isLinux && !this._allowUserspaceProxy) {
      throw new Error(
        `[Axiomify/native] listenClustered() requires Linux for SO_REUSEPORT-based ` +
        `clustering. Current platform: ${process.platform}. On non-Linux platforms ` +
        `Axiomify falls back to a userspace TCP proxy that adds two event-loop hops ` +
        `per byte and largely negates uWS's performance advantage. ` +
        `Either deploy on Linux, use listen() for single-process operation, or set ` +
        `allowUserspaceProxy: true on NativeAdapter options to acknowledge this.`,
      );
    }

    // ── Worker Process ───────────────────────────────────────────────────
    if (!cluster.isPrimary) {
      // Linux uses SO_REUSEPORT (same port). Others use distinct sequential ports.
      const assignedPort = isLinux
        ? this._port
        : this._port + 1 + parseInt(process.env.AXIOMIFY_WORKER_IDX || '0', 10);

      this.listen(
        () => {
          opts.onWorkerReady?.();
          process.send?.({
            type: 'WORKER_READY',
            pid: process.pid,
            port: assignedPort,
          });
        },
        undefined,
        assignedPort,
      );

      process.once('SIGTERM', () => {
        this.close();
        setTimeout(() => {
          console.error(`[Worker ${process.pid}] Drain timeout. Forcing exit.`);
          process.exit(1);
        }, gracefulTimeoutMs).unref();
      });
      return;
    }

    // ── Primary Process ──────────────────────────────────────────────────
    const targetWorkers = Math.min(
      this._workers,
      availableParallelism?.() ?? cpus().length,
    );
    const liveWorkers = new Map<
      number,
      { process: cluster.Worker; state: string; port: number }
    >();

    let isShuttingDown = false;
    let initialBootComplete = false;
    let l4Proxy: import('node:net').Server | null = null;

    // L4 TCP Proxy (macOS / Windows Only)
    // Reached only when allowUserspaceProxy=true on a non-Linux platform.
    // The platform gate at the top of this method has already enforced opt-in;
    // here we emit a startup warning so the degradation is visible in logs.
    if (!isLinux) {
      this._logger.warn(
        `[Axiomify/native] Userspace L4 TCP proxy is active on port ${this._port} ` +
        `(platform: ${process.platform}). Each request now traverses Node.js twice ` +
        `(primary → worker) — expect a significant throughput reduction vs Linux ` +
        `SO_REUSEPORT clustering. This path is intended for development only.`,
        { platform: process.platform, port: this._port, workers: targetWorkers },
      );

      let rrIndex = 0;
      const net = require('node:net');
      l4Proxy = net.createServer((client: import('node:net').Socket) => {
        const readyWorkers = Array.from(liveWorkers.values()).filter(
          (w) => w.state === 'READY',
        );
        if (readyWorkers.length === 0) return client.destroy();

        const target = readyWorkers[rrIndex++ % readyWorkers.length];

        const backend = net.connect(target.port, '127.0.0.1', () => {
          client.pipe(backend);
          backend.pipe(client);
        });

        client.on('error', () => backend.destroy());
        backend.on('error', () => client.destroy());
      });

      l4Proxy?.listen(this._port);
    }

    const spawnWorker = (idx: number, respawnDelayMs = 0) => {
      const w = cluster.fork({ AXIOMIFY_WORKER_IDX: idx.toString() });
      const pid = w.process.pid!;

      liveWorkers.set(pid, { process: w, state: 'STARTING', port: 0 });

      // Linux Production Optimization: CPU Pinning
      if (isLinux) {
        try {
          const { execSync } = require('node:child_process');
          execSync(`taskset -cp ${idx % targetWorkers} ${pid}`, {
            stdio: 'ignore',
          });
        } catch (e) {
          /* Fallback */
        }
      }

      w.on('message', (msg: { type?: string; port?: number }) => {
        if (msg?.type !== 'WORKER_READY') return;

        const record = liveWorkers.get(pid);
        if (record) {
          record.state = 'READY';
          record.port = msg.port!;
        }

        if (!initialBootComplete && liveWorkers.size === targetWorkers) {
          initialBootComplete = true;
          opts.onPrimary?.(Array.from(liveWorkers.keys()));
        }
      });

      w.on('exit', (code) => {
        const record = liveWorkers.get(pid);
        const wasDraining = record?.state === 'DRAINING';
        liveWorkers.delete(pid);
        opts.onWorkerExit?.(pid, code);

        if (isShuttingDown || wasDraining) return;

        // Let external orchestrators (Kubernetes/systemd) manage crash loops instead of
        // suiciding the primary process. Backoff helps prevent CPU pinning.
        const nextDelay = Math.min((respawnDelayMs || 50) * 2, 5_000);
        setTimeout(() => spawnWorker(idx, nextDelay), nextDelay);
      });
      return w;
    };

    // SYSTEM SHUTDOWN
    process.once('SIGTERM', () => {
      isShuttingDown = true;
      l4Proxy?.close();
      if (liveWorkers.size === 0) process.exit(0);

      for (const [pid, record] of liveWorkers.entries()) {
        record.state = 'DRAINING';
        record.process.kill('SIGTERM');
      }
      setTimeout(() => process.exit(1), gracefulTimeoutMs + 2000).unref();
    });

    // ROLLING RESTART
    process.on('SIGUSR2', () => {
      if (isShuttingDown) return;
      const pids = Array.from(liveWorkers.keys());
      let i = 0;

      const replaceNext = () => {
        if (i >= pids.length) return;
        const oldRecord = liveWorkers.get(pids[i]);

        // Spawn replacement using the same logical index
        const newWorker = spawnWorker(i, 0);

        const readyListener = (msg: any) => {
          if (msg?.type === 'WORKER_READY') {
            newWorker.removeListener('message', readyListener);
            if (oldRecord) {
              oldRecord.state = 'DRAINING';
              oldRecord.process.kill('SIGTERM');
            }
            i++;
            replaceNext();
          }
        };
        newWorker.on('message', readyListener);
      };
      replaceNext();
    });

    for (let i = 0; i < targetWorkers; i++) spawnWorker(i);
  }

  public close(): void {
    if (this._listenSocket) {
      uWS.us_listen_socket_close(this._listenSocket);
      this._listenSocket = null;
    }
  }

  /**
   * Wires SIGINT/SIGTERM to a graceful drain sequence:
   *   1. Stop accepting new connections (close the uWS listen socket).
   *   2. Run the caller-supplied `onShutdown` hook (close DB pools, flush
   *      logger buffers, etc.). It is awaited.
   *   3. `process.exit(0)`.
   * If `onShutdown` throws, exits with code 1.
   * If step 2 doesn't complete within `timeoutMs`, force-exits with code 1.
   *
   * This is the unified shutdown entry point for NativeAdapter. Do NOT call
   * `gracefulShutdown()` from `@axiomify/core` on a NativeAdapter — that
   * helper takes a Node.js `http.Server` and will not understand uWS's
   * listen socket. Use this method instead.
   *
   * @example
   * const adapter = new NativeAdapter(app);
   * adapter.listen();
   * adapter.gracefulShutdown({
   *   onShutdown: async () => { await db.close(); },
   *   timeoutMs: 15_000,
   * });
   */
  public gracefulShutdown(options: {
    onShutdown?: () => void | Promise<void>;
    timeoutMs?: number;
  } = {}): void {
    const timeoutMs = options.timeoutMs ?? 10_000;
    this._onShutdown = options.onShutdown ?? (() => {});

    // Detach any signal handlers installed by _installCrashGuard so they
    // don't race the drain sequence below. This makes gracefulShutdown()
    // safe to call either before or after listen().
    for (const { sig, fn } of this._crashSignalHandlers) {
      process.removeListener(sig, fn);
    }
    this._crashSignalHandlers = [];

    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;

      // Force-exit safety net. Unref'd so it never keeps the loop alive
      // on its own. Cleared on clean exit.
      const forceExit = setTimeout(() => {
        this._logger.error(
          '[Axiomify/native] Graceful shutdown timeout exceeded. Forcing exit.',
          { timeoutMs },
        );
        process.exit(1);
      }, timeoutMs);
      forceExit.unref();

      this.close();

      try {
        if (this._onShutdown) await this._onShutdown();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExit);
        this._logger.error('[Axiomify/native] onShutdown threw', { error: err });
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => void drain());
    process.once('SIGINT', () => void drain());
  }
}

export { adaptMiddleware } from './bridge';
