import type {
  AdapterLockToken,
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  CookieOptions,
  HttpMethod,
  RequestState,
  ResponseCapabilities,
  SerializerInput,
} from '@axiomify/core';
import {
  ADAPTER_LOCK_TOKEN,
  AxiomifyError,
  makeSerialize,
  parseCookieHeader,
  RequestStateImpl,
  serializeCookie,
} from '@axiomify/core';
import { readFileSync } from 'node:fs';
import type {
  Http2SecureServer,
  Http2Server,
  Http2ServerRequest,
  Http2ServerResponse,
  ServerHttp2Session,
} from 'node:http2';
import http2 from 'node:http2';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import type { TLSSocket } from 'node:tls';

import { parseBodyBuffer } from './body';
import { buildErrorCache, ErrorCache } from './error-cache';
import { HEADER_INJECTION_PATTERN } from './headers';
import { fastParseQuery } from './query';

// ---------------------------------------------------------------------------
// @axiomify/native — Http2Adapter
//
// uWebSockets.js exposes NO HTTP/2 API from its JS bindings, so HTTP/2
// support lives in this separate adapter built on node:http2. Positioning:
//
//   - NativeAdapter (uWS)  → the HTTP/1.1 raw-throughput path. Use it when
//     the server terminates client connections directly or sits behind an
//     L4 balancer, and requests/second is the metric that matters.
//   - Http2Adapter (this)  → trades peak throughput for HTTP/2 semantics:
//     stream multiplexing over one connection, header compression (HPACK),
//     and mandatory-TLS deployments where clients negotiate h2 via ALPN.
//
// The secure server advertises ALPN ['h2', 'http/1.1'] with allowHTTP1, so
// clients that can't speak h2 transparently fall back to HTTP/1.1 over TLS
// through the same port. Cleartext HTTP/2 (h2c) is available behind an
// explicit opt-in for local development and testing.
//
// The node:http2 Compat API (Http2ServerRequest / Http2ServerResponse) is
// used throughout — it presents the same surface for h2 streams and for the
// http/1.1 ALPN fallback, so one request/response implementation covers both.
// ---------------------------------------------------------------------------

/** Statuses that must not carry a response body (RFC 9110 §6.4.1, §15.3.5/6). */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Connection-specific headers are forbidden on HTTP/2 responses — node:http2
 * throws ERR_HTTP2_INVALID_CONNECTION_HEADERS if they are written. The
 * HTTP/1.1 fallback path doesn't need them either (Node adds chunked
 * framing and keep-alive automatically), so the adapter never emits them.
 */
const FORBIDDEN_H2_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
]);

const H2_CAPABILITIES: ResponseCapabilities = {
  sse: true,
  streaming: true,
};

// Process-local atomic counter for request IDs — same scheme as
// NativeRequest (faster than randomUUID, unique within process lifetime).
let _h2ReqCounter = 0;
const _h2PidHex = process.pid.toString(36);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface Http2AdapterTlsOptions {
  /** PEM private key, inline. Mutually exclusive with `keyFile`. */
  key?: string | Buffer;
  /** PEM certificate (or chain), inline. Mutually exclusive with `certFile`. */
  cert?: string | Buffer;
  /** Path to the PEM private key file (read synchronously at construction). */
  keyFile?: string;
  /** Path to the PEM certificate file (read synchronously at construction). */
  certFile?: string;
  /** Optional passphrase for the private key. */
  passphrase?: string;
  /**
   * ALPN protocols to advertise. The default lets non-h2 clients fall back
   * to HTTP/1.1 over the same TLS port.
   * @default ['h2', 'http/1.1']
   */
  alpnProtocols?: string[];
  /**
   * Accept HTTP/1.1 connections on the same secure port (ALPN fallback).
   * @default true
   */
  allowHTTP1?: boolean;
}

export interface Http2AdapterOptions {
  /** Listening port. @default 3000 (mirrors NativeAdapter) */
  port?: number;
  /**
   * TLS configuration. Required unless `h2c: true` — browsers only speak
   * HTTP/2 over TLS. Provide either inline `key`/`cert` or `keyFile`/`certFile`.
   */
  tls?: Http2AdapterTlsOptions;
  /**
   * Opt-in cleartext HTTP/2 (h2c, no TLS) via `http2.createServer`.
   * Intended for local development, tests, and trusted internal meshes —
   * browsers will NOT connect to an h2c server.
   * @default false
   */
  h2c?: boolean;
  /**
   * Maximum request body size in bytes. Requests exceeding this are
   * rejected with 413 and the stream is destroyed. @default 1 MiB
   */
  maxBodySize?: number;
  /**
   * When true, derive the client IP from `X-Forwarded-For`. Only enable
   * behind a trusted proxy; mirror of NativeAdapter's option.
   * @default false
   */
  trustProxy?: boolean;
  /** Validates the socket peer address before X-Forwarded-For is trusted. */
  proxyIpValidator?: (ip: string) => boolean;
  /**
   * Global request timeout in milliseconds. If headers are not sent within
   * this duration the request is answered with 504. 0 disables.
   * @default 0 (disabled)
   */
  requestTimeout?: number;
  /**
   * Grace period in ms that `close()` allows open sessions/streams to finish
   * before force-destroying them.
   * @default 10_000
   */
  closeTimeout?: number;
  /** Structured logger for adapter warnings. Falls back to `console`. */
  logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * `AxiomifyRequest` implementation for the node:http2 Compat API.
 *
 * Pseudo-headers (`:path`, `:method`, `:authority`, `:scheme`, `:status`)
 * are stripped from `headers` — they are HTTP/2 wire artifacts, not
 * application headers. `:authority` is mapped to `host` when the client
 * did not send a literal Host header, so host-based plugins behave
 * identically across h2 and the http/1.1 fallback.
 *
 * Mirrors NativeRequest's laziness: query, cookies, id, and the
 * AbortController are only materialized on first access.
 */
export class Http2Request implements AxiomifyRequest {
  public method: HttpMethod;
  public url: string;
  public path: string;
  public ip: string;
  public headers: Record<string, string | string[]>;
  public body: unknown;
  public params: Record<string, string> = Object.create(null);
  public state: RequestState = new RequestStateImpl();
  public raw: unknown;
  public stream: Readable;

  private _queryStr: string;
  private _parsedQuery?: Record<string, string | string[]>;
  private _cookies?: Record<string, string>;
  private _id?: string;
  private _controller?: AbortController;
  private _aborted = false;

  constructor(
    method: HttpMethod,
    url: string,
    path: string,
    queryStr: string,
    ip: string,
    headers: Record<string, string | string[]>,
    raw: unknown,
    stream: Readable,
  ) {
    this.method = method;
    this.url = url;
    this.path = path;
    this._queryStr = queryStr;
    this.ip = ip;
    this.headers = headers;
    this.raw = raw;
    this.stream = stream;
  }

  get id(): string {
    if (!this._id) {
      const raw = this.headers['x-request-id'];
      const upstream = Array.isArray(raw) ? raw[0] : raw;
      this._id = upstream ?? `${_h2PidHex}-${(++_h2ReqCounter).toString(36)}`;
    }
    return this._id;
  }

  /** Lazy query parsing. Multi-value keys preserved as `string[]`. */
  get query(): Record<string, string | string[]> {
    if (!this._parsedQuery) {
      this._parsedQuery = fastParseQuery(this._queryStr);
    }
    return this._parsedQuery;
  }

  set query(val: Record<string, string | string[]>) {
    this._parsedQuery = val;
  }

  /** Lazy cookie parsing — the Cookie header is only parsed on first read. */
  get cookies(): Record<string, string> {
    if (!this._cookies) {
      const raw = this.headers['cookie'];
      this._cookies = parseCookieHeader(
        Array.isArray(raw) ? raw[0] : (raw ?? ''),
      );
    }
    return this._cookies;
  }

  /** Lazy AbortSignal — only allocated for handlers that read it. */
  get signal(): AbortSignal {
    if (!this._controller) {
      this._controller = new AbortController();
      if (this._aborted)
        this._controller.abort(new Error('Client aborted request'));
    }
    return this._controller.signal;
  }

  /** Called by the adapter when the underlying stream closes prematurely. */
  onAbort(): void {
    this._aborted = true;
    this._controller?.abort(new Error('Client aborted request'));
  }
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * `AxiomifyResponse` implementation over Http2ServerResponse (Compat API).
 * Semantics mirror NativeResponse: serializer envelope on send(), HEAD body
 * suppression, CR/LF header-injection rejection, multiple Set-Cookie lines,
 * bounded SSE buffering, onStreamClose after stream end.
 */
export class Http2Response implements AxiomifyResponse {
  public statusCode = 200;
  public headersSent = false;
  public aborted = false;
  public isStreaming = false;
  public onStreamClose: (() => void) | null = null;
  public raw: Http2ServerResponse;
  public readonly capabilities: ResponseCapabilities = H2_CAPABILITIES;
  public payload?: unknown;
  public responseMessage?: string;

  private readonly _req: Http2Request;
  private readonly _method: HttpMethod;
  private readonly _serialize: (input: SerializerInput) => unknown;
  private _headers: Record<string, string> = {};
  // Set-Cookie kept out of _headers — RFC 6265 forbids folding multiple
  // cookies into one line; emitted as a string[] header value at write time.
  private _cookies: string[] | null = null;
  private readonly _serializeInput: SerializerInput;
  private readonly _onHeadersSent?: () => void;

  // SSE backpressure state — same cap as NativeResponse.
  private static readonly SSE_PENDING_BYTE_CAP = 1 * 1024 * 1024;
  private _pendingSse: string[] = [];
  private _pendingSseBytes = 0;
  private _flushingSse = false;

  constructor(
    res: Http2ServerResponse,
    req: Http2Request,
    method: HttpMethod,
    serialize: (input: SerializerInput) => unknown,
    onHeadersSent?: () => void,
  ) {
    this.raw = res;
    this._req = req;
    this._method = method;
    this._serialize = serialize;
    this._onHeadersSent = onHeadersSent;
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
    // Reject CR/LF/NUL — response-splitting prevention, identical policy to
    // NativeResponse.header(). node:http2 validates too, but throwing the
    // same adapter-level error keeps behavior uniform across adapters.
    if (
      HEADER_INJECTION_PATTERN.test(key) ||
      HEADER_INJECTION_PATTERN.test(value)
    ) {
      throw new Error(
        `[Axiomify/native] header() rejected CR/LF in name or value ` +
          `(response splitting prevention). Strip control characters before ` +
          `passing user-controlled data to res.header().`,
      );
    }
    const lower = key.toLowerCase();
    if (FORBIDDEN_H2_HEADERS.has(lower)) {
      // Connection-specific headers are illegal on HTTP/2 responses and
      // unnecessary on the h1 fallback; drop silently for portability.
      return this;
    }
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

  cookie(name: string, value: string, options?: CookieOptions): this {
    // serializeCookie validates name/value/attributes (incl. the CR/LF
    // injection class) and throws on bad input.
    (this._cookies ??= []).push(serializeCookie(name, value, options));
    return this;
  }

  clearCookie(
    name: string,
    options?: Pick<CookieOptions, 'domain' | 'path' | 'secure' | 'sameSite'>,
  ): this {
    return this.cookie(name, '', {
      ...options,
      expires: new Date(0),
      maxAge: 0,
    });
  }

  /** Writes status + accumulated headers + Set-Cookie lines exactly once. */
  private _writeHead(contentType?: string): void {
    const out: Record<string, string | string[]> = {};
    if (contentType !== undefined) out['content-type'] = contentType;
    for (const k in this._headers) out[k] = this._headers[k];
    if (this._cookies !== null) out['set-cookie'] = this._cookies;
    this.raw.writeHead(this.statusCode, out);
  }

  send<T>(data: T, message?: string): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;
    this._onHeadersSent?.();

    const inp = this._serializeInput;
    inp.data = data;
    inp.message = message;
    inp.statusCode = this.statusCode;
    inp.isError = this.statusCode >= 400;
    const payload = this._serialize(inp);

    // Stored for ValidatingResponse introspection (parity with native).
    this.payload = payload;
    this.responseMessage = message;

    // HEAD: headers only. 204/205/304: node:http2 forbids a payload on
    // null-body statuses (ERR_HTTP2_PAYLOAD_FORBIDDEN); send headers only.
    if (NULL_BODY_STATUSES.has(this.statusCode)) {
      this._writeHead();
      this.raw.end();
      return;
    }

    const body = JSON.stringify(payload);
    this._writeHead('application/json');
    if (this._method === 'HEAD') {
      this.raw.end();
    } else {
      this.raw.end(body);
    }
  }

  sendRaw(payload: unknown, contentType = 'text/plain'): void {
    if (this.headersSent || this.aborted) return;
    if (HEADER_INJECTION_PATTERN.test(contentType)) {
      throw new Error(
        `[Axiomify/native] sendRaw() rejected CR/LF in contentType (response splitting prevention).`,
      );
    }
    this.headersSent = true;
    this._onHeadersSent?.();

    const body =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload
          : String(payload);

    if (NULL_BODY_STATUSES.has(this.statusCode)) {
      this._writeHead();
      this.raw.end();
      return;
    }
    this._writeHead(contentType);
    if (this._method === 'HEAD') {
      this.raw.end();
    } else {
      this.raw.end(body);
    }
  }

  stream(readable: Readable, contentType = 'application/octet-stream'): void {
    if (this.headersSent || this.aborted) return;
    if (HEADER_INJECTION_PATTERN.test(contentType)) {
      throw new Error(
        `[Axiomify/native] stream() rejected CR/LF in contentType (response splitting prevention).`,
      );
    }
    this.headersSent = true;
    this._onHeadersSent?.();
    this.isStreaming = true;

    this._writeHead(contentType);
    // No Transfer-Encoding header: HTTP/2 has native DATA framing; the h1
    // fallback gets chunked encoding from Node automatically.

    const res = this.raw;
    const self = this;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      self.onStreamClose?.();
    };

    // pipe() gives us pause/resume backpressure against the HTTP/2 stream's
    // flow-control window (or the h1 socket) for free.
    readable.pipe(res as unknown as NodeJS.WritableStream, { end: true });

    readable.on('error', () => {
      if (!self.aborted) {
        try {
          res.end();
        } catch {
          /* stream already gone */
        }
      }
      finish();
    });
    readable.on('close', finish);

    // Client disconnect: destroy the source so it stops producing.
    if (this._req.signal.aborted) {
      readable.destroy();
    } else {
      const abortListener = () => readable.destroy();
      this._req.signal.addEventListener('abort', abortListener);
      readable.on('close', () =>
        this._req.signal.removeEventListener('abort', abortListener),
      );
    }
  }

  sseInit(sseHeartbeatMs?: number): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;
    this._onHeadersSent?.();

    // 'Connection: keep-alive' (which NativeResponse sets for HTTP/1.1) is
    // forbidden on HTTP/2 and implicit on the h1 fallback — omitted here.
    if (this._headers['cache-control'] === undefined) {
      this._headers['cache-control'] = 'no-cache';
    }
    this._writeHead('text/event-stream');

    if (sseHeartbeatMs) {
      const interval = setInterval(() => {
        this.sseSend(null, 'ping');
      }, sseHeartbeatMs);
      // Cleared on client disconnect — never leaks past the request.
      this._req.signal.addEventListener('abort', () => clearInterval(interval));
      this.raw.once('close', () => clearInterval(interval));
    }

    this.isStreaming = true;
    this._req.signal.addEventListener('abort', () => {
      this.onStreamClose?.();
    });
  }

  private _flushSse(): void {
    if (this.aborted) return;
    const res = this.raw;
    while (this._pendingSse.length > 0) {
      const chunk = this._pendingSse[0];
      let ok: boolean;
      try {
        ok = res.write(chunk);
      } catch {
        // Stream torn down mid-write.
        this.aborted = true;
        return;
      }
      this._pendingSse.shift();
      this._pendingSseBytes -= chunk.length;
      if (!ok) {
        if (!this._flushingSse) {
          this._flushingSse = true;
          res.once('drain', () => {
            this._flushingSse = false;
            this._flushSse();
          });
        }
        return;
      }
    }
  }

  sseSend(data: unknown, event?: string): void {
    if (this.aborted) return;
    if (!this.headersSent) {
      this.sseInit();
    }

    // Identical framing to NativeResponse.sseSend.
    const parts: string[] = [];
    if (event) {
      parts.push('event: ', event, '\n');
    }
    if (data !== undefined && data !== null) {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      const lines = serialized.split('\n');
      for (const line of lines) {
        parts.push('data: ', line, '\n');
      }
    }
    parts.push('\n');
    const payload = parts.join('');

    if (
      this._pendingSseBytes + payload.length >
      Http2Response.SSE_PENDING_BYTE_CAP
    ) {
      // Slow consumer — close rather than buffer unboundedly. EventSource
      // clients auto-reconnect with Last-Event-ID, so this is recoverable.
      this.aborted = true;
      try {
        this.raw.end();
      } catch {
        /* already ended */
      }
      return;
    }

    this._pendingSse.push(payload);
    this._pendingSseBytes += payload.length;
    this._flushSse();
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class Http2Adapter {
  private readonly _app: Axiomify;
  private readonly _port: number;
  private readonly _server: Http2SecureServer | Http2Server;
  private readonly _maxBodySize: number;
  private readonly _trustProxy: boolean;
  private readonly _proxyIpValidator?: (ip: string) => boolean;
  private readonly _requestTimeout: number;
  private readonly _closeTimeout: number;
  private readonly _logger: NonNullable<Http2AdapterOptions['logger']>;
  private readonly _serialize: (input: SerializerInput) => unknown;
  private readonly _errorCache: ErrorCache;
  private readonly _lockToken: AdapterLockToken = ADAPTER_LOCK_TOKEN;

  private readonly _sessions = new Set<ServerHttp2Session>();
  private readonly _sockets = new Set<Socket | TLSSocket>();
  private _listening = false;
  private _closed = false;
  private _inflight = 0;
  private _drainResolvers: (() => void)[] = [];
  private _onShutdown?: () => void | Promise<void>;

  constructor(app: Axiomify, options: Http2AdapterOptions = {}) {
    this._app = app;
    this._app.lockRoutes(ADAPTER_LOCK_TOKEN, '@axiomify/native Http2Adapter');
    this._port = options.port ?? 3000;
    this._maxBodySize = options.maxBodySize ?? 1_048_576;
    this._trustProxy = options.trustProxy ?? false;
    this._proxyIpValidator = options.proxyIpValidator;
    this._requestTimeout = options.requestTimeout ?? 0;
    this._closeTimeout = options.closeTimeout ?? 10_000;
    this._logger = options.logger ?? {
      warn: (msg, meta) => console.warn(msg, meta ?? ''),
      error: (msg, meta) => console.error(msg, meta ?? ''),
    };

    // Same startup guard as NativeAdapter: a bare trustProxy is a spoofable
    // X-Forwarded-For sink. Warn (or throw under strictSchema).
    if (this._trustProxy && !this._proxyIpValidator) {
      const msg =
        'AxiomifyWarning: trustProxy is enabled but no proxyIpValidator is configured. ' +
        'X-Forwarded-For can be spoofed to bypass rate limiting. ' +
        'Configure a CIDR allowlist for trusted proxy IPs.';
      if (this._app.strictSchema) {
        throw new AxiomifyError(msg);
      } else {
        this._logger.warn(msg);
      }
    }

    this._serialize = makeSerialize(this._app.serializer);
    this._errorCache = buildErrorCache(this._app.serializer);

    if (options.tls) {
      const { key, cert } = this._resolveTls(options.tls);
      this._server = http2.createSecureServer({
        key,
        cert,
        passphrase: options.tls.passphrase,
        allowHTTP1: options.tls.allowHTTP1 ?? true,
        ALPNProtocols: options.tls.alpnProtocols ?? ['h2', 'http/1.1'],
      });
    } else if (options.h2c) {
      this._server = http2.createServer();
    } else {
      throw new AxiomifyError(
        '[Axiomify/native] Http2Adapter requires TLS. Browsers only negotiate ' +
          'HTTP/2 over TLS+ALPN — pass `tls: { key, cert }` (inline PEM) or ' +
          '`tls: { keyFile, certFile }` (paths). For local development or ' +
          'trusted internal traffic you can opt into cleartext HTTP/2 with ' +
          '`h2c: true`.',
      );
    }

    // Session/socket tracking for graceful shutdown. 'session' fires for h2
    // sessions; 'connection'/'secureConnection' also covers the http/1.1
    // ALPN-fallback sockets so close() can force-destroy stragglers.
    this._server.on('session', (session: ServerHttp2Session) => {
      this._sessions.add(session);
      session.once('close', () => this._sessions.delete(session));
    });
    const trackSocket = (socket: Socket | TLSSocket) => {
      this._sockets.add(socket);
      socket.once('close', () => this._sockets.delete(socket));
    };
    this._server.on('connection', trackSocket);
    this._server.on('secureConnection', trackSocket);

    this._server.on(
      'request',
      (req: Http2ServerRequest, res: Http2ServerResponse) => {
        this._dispatch(req, res);
      },
    );
  }

  // -------------------------------------------------------------------------
  // TLS material
  // -------------------------------------------------------------------------

  private _resolveTls(tls: Http2AdapterTlsOptions): {
    key: string | Buffer;
    cert: string | Buffer;
  } {
    const readPem = (file: string, what: string): Buffer => {
      try {
        return readFileSync(file);
      } catch (err) {
        throw new AxiomifyError(
          `[Axiomify/native] Http2Adapter could not read the TLS ${what} at ` +
            `"${file}": ${(err as Error).message}`,
        );
      }
    };

    const key =
      tls.key ??
      (tls.keyFile ? readPem(tls.keyFile, 'private key') : undefined);
    const cert =
      tls.cert ??
      (tls.certFile ? readPem(tls.certFile, 'certificate') : undefined);

    if (!key || !cert) {
      throw new AxiomifyError(
        '[Axiomify/native] Http2Adapter tls options are incomplete. Provide ' +
          'both a private key (`key` or `keyFile`) and a certificate ' +
          '(`cert` or `certFile`).',
      );
    }
    return { key, cert };
  }

  // -------------------------------------------------------------------------
  // Client IP — trustProxy semantics mirror NativeAdapter._extractIp:
  // X-Forwarded-For is only consulted when trustProxy is on AND the
  // configured validator approves the socket peer address.
  // -------------------------------------------------------------------------

  private _extractIp(
    socketAddress: string,
    headers: Record<string, string | string[]>,
  ): string {
    if (this._trustProxy && this._proxyIpValidator) {
      if (this._proxyIpValidator(socketAddress)) {
        const xff = headers['x-forwarded-for'];
        const first = Array.isArray(xff) ? xff[0] : xff;
        if (first) {
          const client = first.split(',')[0].trim();
          if (client) return client;
        }
      }
    }
    return socketAddress;
  }

  // -------------------------------------------------------------------------
  // Request dispatch
  // -------------------------------------------------------------------------

  private _writeCachedError(
    res: Http2ServerResponse,
    cached: { statusLine: string; body: string },
    statusCode: number,
  ): void {
    try {
      if (!res.headersSent) {
        res.writeHead(statusCode, { 'content-type': 'application/json' });
      }
      res.end(cached.body);
    } catch {
      /* stream already destroyed */
    }
  }

  private _dispatch(req: Http2ServerRequest, res: Http2ServerResponse): void {
    const method = (req.method || 'GET').toUpperCase() as HttpMethod;
    const rawUrl = req.url || '/';
    const qIdx = rawUrl.indexOf('?');
    const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const queryStr = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);

    // Strip HTTP/2 pseudo-headers; map :authority → host when the client
    // did not send a literal Host header (h2 clients normally don't).
    const rawHeaders = req.headers as Record<
      string,
      string | string[] | undefined
    >;
    const headers: Record<string, string | string[]> = Object.create(null);
    for (const k in rawHeaders) {
      if (k.charCodeAt(0) === 58 /* ':' */) continue;
      const v = rawHeaders[k];
      if (v !== undefined) headers[k] = v;
    }
    if (headers['host'] === undefined) {
      const authority = rawHeaders[':authority'];
      if (typeof authority === 'string' && authority.length > 0) {
        headers['host'] = authority;
      }
    }

    const socketAddress = req.socket?.remoteAddress ?? '';
    const ip = this._extractIp(socketAddress, headers);

    const needsBody =
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE';

    const axReq = new Http2Request(
      method,
      rawUrl,
      path,
      queryStr,
      ip,
      headers,
      { req, res },
      // Replaced with the buffered body below for body-bearing methods.
      new Readable({ read() {} }),
    );

    let timeoutTimer: NodeJS.Timeout | null = null;
    const axRes = new Http2Response(res, axReq, method, this._serialize, () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    });

    if (this._requestTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        if (!axRes.aborted && !axRes.headersSent) {
          axRes.aborted = true;
          axReq.onAbort();
          this._writeCachedError(res, this._errorCache.cached504, 504);
        }
      }, this._requestTimeout);
    }

    // Premature client disconnect → abort signal + response tombstone.
    res.once('close', () => {
      if (!res.writableEnded) {
        axRes.aborted = true;
        axReq.onAbort();
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    });

    this._inflight++;
    const finalize = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      this._inflight--;
      if (this._inflight === 0 && this._drainResolvers.length > 0) {
        const resolvers = this._drainResolvers;
        this._drainResolvers = [];
        for (const r of resolvers) r();
      }
    };

    const run = async (): Promise<void> => {
      if (needsBody) {
        const body = await this._readBody(req, res, axReq);
        if (body === null) {
          // 413 already sent, or the client vanished mid-body.
          return;
        }
        // Parse unconditionally — including an empty buffer — to match
        // NativeAdapter exactly. Gating this behind `body.length > 0`
        // left `axReq.body` as `undefined` for an empty urlencoded/raw
        // body, where NativeAdapter (which always calls parseBodyBuffer)
        // produces `{}`/an empty Buffer; a handler written against that
        // NativeAdapter behavior would crash only under Http2Adapter.
        const ctRaw = headers['content-type'];
        const contentType = (Array.isArray(ctRaw) ? ctRaw[0] : ctRaw) ?? '';
        axReq.body = parseBodyBuffer(body, contentType);
        if (body.length > 0) {
          axReq.stream = Readable.from(body);
        }
      }

      if (axRes.aborted) return;
      // app.handle() runs the JS radix router — the correct generic-adapter
      // entry point (uWS pre-routes in C++; here Node gives us raw requests).
      await this._app.handle(axReq, axRes);
    };

    run()
      .catch((err: unknown) => {
        // Top-level catch — same policy as NativeAdapter: preserve HTTP
        // error statusCodes thrown by handlers, default to 500, and never
        // let a rejection reach 'unhandledRejection'.
        if (!axRes.aborted && !axRes.headersSent) {
          try {
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
            axRes.status(errStatus).send(null, errMsg);
          } catch {
            this._writeCachedError(res, this._errorCache.cached500, 500);
          }
        }
      })
      .finally(finalize);
  }

  /**
   * Buffers the request body enforcing `maxBodySize`. On overflow the 413
   * is written first and the stream is destroyed in the flush callback, so
   * the client sees the rejection instead of a bare RST_STREAM.
   * Returns `null` when no usable body will arrive (413 sent or aborted).
   */
  private _readBody(
    req: Http2ServerRequest,
    res: Http2ServerResponse,
    axReq: Http2Request,
  ): Promise<Buffer | null> {
    const maxBodySize = this._maxBodySize;
    const cached413 = this._errorCache.cached413;

    return new Promise((resolve) => {
      // Fast path: reject on declared Content-Length before reading a byte.
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBodySize) {
        try {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(cached413.body, () => req.destroy());
        } catch {
          /* stream gone */
        }
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      const onData = (chunk: Buffer) => {
        if (settled) return;
        total += chunk.byteLength;
        if (total > maxBodySize) {
          settled = true;
          req.removeListener('data', onData);
          try {
            if (!res.headersSent) {
              res.writeHead(413, { 'content-type': 'application/json' });
            }
            // Destroy only after the 413 has flushed — destroying first
            // would RST the stream before the client reads the status.
            res.end(cached413.body, () => req.destroy());
          } catch {
            try {
              req.destroy();
            } catch {
              /* already gone */
            }
          }
          resolve(null);
          return;
        }
        chunks.push(chunk);
      };

      req.on('data', onData);
      req.once('end', () => {
        if (settled) return;
        settled = true;
        resolve(
          chunks.length === 0
            ? Buffer.alloc(0)
            : chunks.length === 1
              ? chunks[0]
              : Buffer.concat(chunks, total),
        );
      });
      req.once('error', () => {
        if (settled) return;
        settled = true;
        axReq.onAbort();
        resolve(null);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start listening. The callback receives the bound port (useful with
   * `port: 0` for ephemeral test servers).
   */
  public listen(
    callback?: (port: number) => void,
    onError?: (err: Error) => void,
    portOverride?: number,
  ): void {
    const port = portOverride ?? this._port;
    const handleError = (err: Error) => {
      if (onError) {
        onError(err);
      } else {
        queueMicrotask(() => {
          throw err;
        });
      }
    };
    this._server.once('error', handleError);
    this._server.listen(port, '0.0.0.0', () => {
      this._server.removeListener('error', handleError);
      this._listening = true;
      this._installCrashGuard();
      const addr = this._server.address();
      callback?.(typeof addr === 'object' && addr !== null ? addr.port : port);
    });
  }

  /**
   * Stop accepting new connections and drain existing ones:
   *   1. `server.close()` — the listen socket stops accepting.
   *   2. `session.close()` on every live HTTP/2 session — sends GOAWAY,
   *      in-flight streams are allowed to finish.
   *   3. After `closeTimeout` ms, any session/socket still open is
   *      force-destroyed (timer is unref'd — it never holds the loop open).
   * Idempotent; also detaches the signal/exit listeners installed by
   * `listen()` so repeated construct/close cycles never leak handlers.
   */
  public close(): void {
    if (!this._closed) {
      this._closed = true;
      if (this._listening) {
        try {
          this._server.close();
        } catch {
          /* not listening */
        }
        this._listening = false;
      }
      for (const session of this._sessions) {
        try {
          session.close();
        } catch {
          /* already closed */
        }
      }
      const force = setTimeout(() => {
        for (const session of this._sessions) {
          try {
            session.destroy();
          } catch {
            /* already gone */
          }
        }
        for (const socket of this._sockets) {
          try {
            socket.destroy();
          } catch {
            /* already gone */
          }
        }
      }, this._closeTimeout);
      force.unref();
    }
    this._removeCrashGuard();
  }

  /** Resolves once no requests are in flight. @internal */
  private _waitForDrain(): Promise<void> {
    if (this._inflight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._drainResolvers.push(resolve);
    });
  }

  // Crash-guard bookkeeping — mirror of NativeAdapter._installCrashGuard.
  // Every listener registered on `process` is stored so close() /
  // gracefulShutdown() can detach it: no leaked handlers across
  // construct/close cycles (vitest runs many adapters per process).
  private _crashGuardInstalled = false;
  private _exitCleanupFn: (() => void) | null = null;
  private _crashSignalHandlers: {
    sig: 'SIGINT' | 'SIGTERM';
    fn: () => void;
  }[] = [];

  private _installCrashGuard(): void {
    if (this._crashGuardInstalled) return;
    this._crashGuardInstalled = true;

    this._exitCleanupFn = () => this.close();
    process.once('exit', this._exitCleanupFn);

    // If gracefulShutdown() already owns the signals, don't double-register.
    if (this._onShutdown !== undefined) return;

    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const fn = () => {
        if (this._exitCleanupFn) this._exitCleanupFn();
        process.exit(0);
      };
      this._crashSignalHandlers.push({ sig, fn });
      process.once(sig, fn);
    }
  }

  private _removeCrashGuard(): void {
    if (!this._crashGuardInstalled) return;
    if (this._exitCleanupFn) {
      process.removeListener('exit', this._exitCleanupFn);
      this._exitCleanupFn = null;
    }
    for (const { sig, fn } of this._crashSignalHandlers) {
      process.removeListener(sig, fn);
    }
    this._crashSignalHandlers = [];
    this._crashGuardInstalled = false;
  }

  /**
   * Wires SIGINT/SIGTERM to a graceful drain sequence (mirror of
   * NativeAdapter.gracefulShutdown):
   *   1. Stop accepting connections + GOAWAY live sessions (close()).
   *   2. Wait for in-flight requests to finish.
   *   3. Run the caller's `onShutdown` (awaited), then `process.exit(0)`.
   * Force-exits with code 1 if the drain exceeds `timeoutMs` or
   * `onShutdown` throws.
   */
  public gracefulShutdown(
    options: {
      onShutdown?: () => void | Promise<void>;
      timeoutMs?: number;
    } = {},
  ): void {
    const timeoutMs = options.timeoutMs ?? 10_000;
    this._onShutdown = options.onShutdown ?? (() => {});

    // Take signal ownership from the crash guard (installed by listen())
    // so the two paths never race — same handoff as NativeAdapter.
    for (const { sig, fn } of this._crashSignalHandlers) {
      process.removeListener(sig, fn);
    }
    this._crashSignalHandlers = [];

    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;

      const forceExit = setTimeout(() => {
        this._logger.error(
          '[Axiomify/native] Http2Adapter graceful shutdown timeout exceeded. Forcing exit.',
          { timeoutMs },
        );
        process.exit(1);
      }, timeoutMs);
      forceExit.unref();

      this.close();

      try {
        await this._waitForDrain();
        if (this._inflight > 0) {
          this._logger.warn(
            '[Axiomify/native] Http2Adapter draining with in-flight requests ' +
              '(likely a long-lived stream).',
            { inflight: this._inflight },
          );
        }
        if (this._onShutdown) await this._onShutdown();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExit);
        this._logger.error('[Axiomify/native] onShutdown threw', {
          error: err,
        });
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => void drain());
    process.once('SIGINT', () => void drain());
  }
}
