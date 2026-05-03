/**
 * Typed declarations for uWebSockets.js.
 *
 * uWS ships pre-built native binaries and does not provide bundled TypeScript
 * declarations. These types cover the surface Axiomify uses; they are not an
 * exhaustive re-declaration of the uWS C++ API.
 */
declare module 'uWebSockets.js' {
  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  /** Represents an in-flight HTTP response. */
  export interface HttpResponse {
    /**
     * Register a handler for when the client aborts before the response is
     * complete. MUST be called before any async work on every request.
     */
    onAborted(handler: () => void): HttpResponse;

    /**
     * Register a streaming data handler. The provided ArrayBuffer is ONLY
     * valid for the duration of the callback — copy it immediately.
     *
     * @param handler Called once per received chunk. `isLast` is true on the
     *                final chunk; the body is complete after that callback.
     */
    onData(
      handler: (chunk: ArrayBuffer, isLast: boolean) => void,
    ): HttpResponse;

    /**
     * Register a writable handler called when back-pressure clears. Return
     * true when you have successfully drained all pending data; false to keep
     * the handler registered.
     */
    onWritable(handler: (offset: number) => boolean): HttpResponse;

    /**
     * Batch all writes in `cb` into a single TCP send. Using cork around every
     * `writeStatus` + `writeHeader` + `end` call is the primary mechanism for
     * achieving maximum throughput in uWS.
     */
    cork(cb: () => void): HttpResponse;

    /**
     * Write the HTTP status line, e.g. `"200 OK"` or `"404 Not Found"`.
     * Must be called before writeHeader or end.
     */
    writeStatus(status: string): HttpResponse;

    /** Write a single response header. Call multiple times for multiple headers. */
    writeHeader(key: string, value: string): HttpResponse;

    /**
     * Write a partial body chunk. Returns false if the send buffer is full
     * (back-pressure); pause the source and use onWritable to resume.
     */
    write(chunk: string | ArrayBuffer): boolean;

    /**
     * Finalise and send the response. An empty string is valid for HEAD and
     * 204 No Content responses.
     */
    end(chunk?: string | ArrayBuffer): HttpResponse;

    /**
     * Returns the remote IP address as a UTF-8 encoded ArrayBuffer.
     * Copy immediately — the buffer is reused internally.
     */
    getRemoteAddressAsText(): ArrayBuffer;

    /**
     * Returns the proxied (forwarded) remote IP when uWS is behind a proxy.
     * Falls back to the direct IP if no proxy header is present.
     */
    getProxiedRemoteAddressAsText(): ArrayBuffer;

    /**
     * Perform the WebSocket upgrade handshake. Must be called inside a
     * ws.upgrade handler.
     */
    upgrade(
      userData: Record<string, unknown>,
      secWebSocketKey: string,
      secWebSocketProtocol: string,
      secWebSocketExtensions: string,
      context: unknown,
    ): void;
  }

  /** Represents an in-flight HTTP request. Only valid during the synchronous handler; do not hold references. */
  export interface HttpRequest {
    /** Returns a request header value by lowercase key. Returns '' if absent. */
    getHeader(lowerCaseKey: string): string;
    /** Returns the i-th path parameter (0-indexed, left-to-right). Returns '' if absent. */
    getParameter(index: number): string;
    /** Returns the HTTP method in lowercase (e.g. 'get', 'post'). */
    getMethod(): string;
    /** Returns the request path without query string. */
    getUrl(): string;
    /** Returns the raw query string (without the leading '?'). */
    getQuery(): string;
    /** Iterates all request headers, calling `cb(key, value)` for each. */
    forEach(cb: (key: string, value: string) => void): void;
    /** Returns a specific query parameter value by name. */
    getQuery(key: string): string;
  }

  export type HttpHandler = (res: HttpResponse, req: HttpRequest) => void;

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  export interface WebSocketBehavior<UserData = unknown> {
    compression?: number;
    maxPayloadLength?: number;
    idleTimeout?: number;
    sendPingsAutomatically?: boolean;
    upgrade?: (
      res: HttpResponse,
      req: HttpRequest,
      context: unknown,
    ) => void;
    open?: (ws: WebSocket<UserData>) => void;
    message?: (
      ws: WebSocket<UserData>,
      message: ArrayBuffer,
      isBinary: boolean,
    ) => void;
    drain?: (ws: WebSocket<UserData>) => void;
    close?: (
      ws: WebSocket<UserData>,
      code: number,
      message: ArrayBuffer,
    ) => void;
  }

  export interface WebSocket<UserData = unknown> {
    /** Send a message. Returns 1 on success, 2 on dropped, 0 on back-pressure. */
    send(
      message: string | ArrayBuffer,
      isBinary?: boolean,
      compress?: boolean,
    ): number;
    close(): void;
    end(code?: number, message?: string): void;
    getBufferedAmount(): number;
    getUserData(): UserData;
    subscribe(topic: string): boolean;
    publish(topic: string, message: string | ArrayBuffer, isBinary?: boolean, compress?: boolean): boolean;
  }

  // -------------------------------------------------------------------------
  // App
  // -------------------------------------------------------------------------

  export interface TemplatedApp {
    /** Register a GET handler. */
    get(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a POST handler. */
    post(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register an OPTIONS handler. */
    options(pattern: string, handler: HttpHandler): TemplatedApp;
    /**
     * Register a DELETE handler. Named `del` because `delete` is a reserved
     * JavaScript keyword.
     */
    del(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a PATCH handler. */
    patch(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a PUT handler. */
    put(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a HEAD handler. */
    head(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a CONNECT handler. */
    connect(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a TRACE handler. */
    trace(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a handler for any HTTP method. Useful for 404 catch-alls. */
    any(pattern: string, handler: HttpHandler): TemplatedApp;
    /** Register a WebSocket endpoint. */
    ws<UserData = unknown>(
      pattern: string,
      behavior: WebSocketBehavior<UserData>,
    ): TemplatedApp;
    /**
     * Start listening on `port`. The token passed to `cb` is truthy on
     * success; falsy when the port is unavailable.
     */
    listen(port: number, cb: (token: unknown) => void): void;
    /** Listen on a specific host. */
    listen(host: string, port: number, cb: (token: unknown) => void): void;
  }

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  /** Shared compression context — lower memory, still effective. */
  export const SHARED_COMPRESSOR: number;
  /** Dedicated per-connection compression context — maximum compression. */
  export const DEDICATED_COMPRESSOR: number;
  /** Disable per-message compression entirely. */
  export const DISABLED: number;

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  /** Create an HTTP (non-TLS) uWS app. */
  export function App(): TemplatedApp;
  /** Create an HTTPS (TLS) uWS app. */
  export function SSLApp(options: {
    key_file_name: string;
    cert_file_name: string;
    passphrase?: string;
    dh_params_file_name?: string;
    ssl_prefer_low_memory_usage?: boolean;
  }): TemplatedApp;
  /** Close a listen socket returned by a successful listen() call. */
  export function us_listen_socket_close(token: unknown): void;
}
