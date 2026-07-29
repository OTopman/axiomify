import type {
  AxiomifyResponse,
  CookieOptions,
  HttpMethod,
  ResponseCapabilities,
  SerializerInput,
} from '@axiomify/core';
import { serializeCookie } from '@axiomify/core';
import type { Readable } from 'node:stream';
import { parseSetCookie, type ParsedSetCookie } from './set-cookie';

// Same response-splitting guard the native adapter enforces — tests should
// catch CR/LF injection into header values, not mask it.
const HEADER_INJECTION_PATTERN = /[\r\n\0]/;

const TEST_CAPABILITIES: ResponseCapabilities = {
  sse: true,
  streaming: true,
};

/** A single Server-Sent Event captured by the test response. */
export interface CapturedSseEvent {
  /** The value passed to `res.sseSend()` (before SSE framing). */
  data: unknown;
  /** The `event:` field, when one was provided. */
  event?: string;
}

/**
 * Capturing `AxiomifyResponse` returned by `client.inject()`.
 *
 * Implements the complete response surface — including the optional
 * `cookie()` / `clearCookie()` / `sseInit()` / `sseSend()` methods — and
 * applies the app's serializer exactly like `NativeResponse.send()` does,
 * so the captured payload envelope is byte-identical to production.
 *
 * After `inject()` resolves, read the result via:
 *   - `statusCode` — final HTTP status
 *   - `headers`    — lowercase header map; `set-cookie` is always `string[]`
 *   - `body`       — raw response body string
 *   - `json<T>()`  — parsed JSON body
 *   - `cookies`    — structured parse of every `Set-Cookie` line
 *   - `sseEvents`  — events captured from `sseSend()`
 *   - `data`       — the raw value passed to `res.send()` (pre-serializer)
 */
export class TestResponse implements AxiomifyResponse {
  public statusCode = 200;
  public headersSent = false;
  public isStreaming = false;
  public readonly capabilities: ResponseCapabilities = TEST_CAPABILITIES;
  public readonly raw: unknown = null;

  /** The raw value passed to `res.send()` before serialization. */
  public data: unknown = undefined;
  /** The message passed to `res.send(data, message)`, when any. */
  public message: string | undefined;
  /** The serialized payload (output of the app's serializer). */
  public payload: unknown = undefined;
  /** Events captured from `sseSend()`. */
  public readonly sseEvents: CapturedSseEvent[] = [];
  /** True once `sseInit()` / first `sseSend()` ran. */
  public sseStarted = false;
  /** Heartbeat interval requested via `sseInit(ms)` (never scheduled). */
  public sseHeartbeatMs: number | undefined;

  private readonly _method: HttpMethod;
  private readonly _serialize: (input: SerializerInput) => unknown;
  private readonly _serializeInput: SerializerInput;
  private _headers: Record<string, string> = {};
  private _setCookies: string[] = [];
  private _body = '';
  private _sseText = '';
  private _streamError: Error | null = null;

  private _completed = false;
  private _waiters: Array<() => void> = [];
  private _streamEnded = false;
  private _onStreamClose: (() => void) | null = null;

  constructor(
    method: HttpMethod,
    serialize: (input: SerializerInput) => unknown,
    req?: unknown,
  ) {
    this._method = method;
    this._serialize = serialize;
    this._serializeInput = {
      data: undefined,
      message: undefined,
      statusCode: 200,
      isError: false,
      req: req as SerializerInput['req'],
    };
  }

  // ─── AxiomifyResponse surface ───────────────────────────────────────────────

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  header(key: string, value: string): this {
    if (
      HEADER_INJECTION_PATTERN.test(key) ||
      HEADER_INJECTION_PATTERN.test(value)
    ) {
      throw new Error(
        '[@axiomify/testing] header() rejected CR/LF in name or value ' +
          '(response splitting prevention) — same guard as @axiomify/native.',
      );
    }
    this._headers[key.toLowerCase()] = value;
    return this;
  }

  getHeader(key: string): string | undefined {
    return this._headers[key.toLowerCase()];
  }

  removeHeader(key: string): this {
    delete this._headers[key.toLowerCase()];
    return this;
  }

  cookie(name: string, value: string, options?: CookieOptions): this {
    // serializeCookie validates name/value/attributes and throws on bad
    // input — identical behavior to NativeResponse.cookie().
    this._setCookies.push(serializeCookie(name, value, options));
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

  send<T>(data: T, message?: string): void {
    if (this.headersSent) return;
    this.headersSent = true;

    // Apply the app's serializer exactly like NativeResponse.send() so the
    // captured payload envelope matches production byte-for-byte.
    const inp = this._serializeInput;
    inp.data = data;
    inp.message = message;
    inp.statusCode = this.statusCode;
    inp.isError = this.statusCode >= 400;
    const payload = this._serialize(inp);

    this.data = data;
    this.message = message;
    this.payload = payload;

    this._headers['content-type'] ??= 'application/json';
    // HEAD responses: headers only, no body (RFC 9110 §9.3.2) — same
    // suppression NativeResponse performs.
    this._body = this._method === 'HEAD' ? '' : JSON.stringify(payload);
    this._finish();
  }

  sendRaw(payload: unknown, contentType = 'text/plain'): void {
    if (this.headersSent) return;
    if (HEADER_INJECTION_PATTERN.test(contentType)) {
      throw new Error(
        '[@axiomify/testing] sendRaw() rejected CR/LF in contentType ' +
          '(response splitting prevention).',
      );
    }
    this.headersSent = true;
    this._headers['content-type'] = contentType;
    this._body =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : String(payload);
    this._finish();
  }

  stream(readable: Readable, contentType = 'application/octet-stream'): void {
    if (this.headersSent) return;
    if (HEADER_INJECTION_PATTERN.test(contentType)) {
      throw new Error(
        '[@axiomify/testing] stream() rejected CR/LF in contentType ' +
          '(response splitting prevention).',
      );
    }
    this.headersSent = true;
    this.isStreaming = true;
    this._headers['content-type'] = contentType;
    this._headers['transfer-encoding'] = 'chunked';

    const chunks: Buffer[] = [];
    readable.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    const settle = (err?: Error) => {
      if (this._streamEnded) return;
      this._streamEnded = true;
      if (err) this._streamError = err;
      this._body = Buffer.concat(chunks).toString('utf8');
      // Fire the dispatcher-assigned deferred onClose hook, mirroring
      // NativeResponse's readable.on('close') behavior. If the dispatcher
      // has not assigned it yet (short synchronous streams end before the
      // dispatcher's finally block runs), the onStreamClose setter below
      // fires it on assignment.
      this._onStreamClose?.();
      this._finish();
    };
    readable.on('end', () => settle());
    readable.on('error', (err: Error) => settle(err));
  }

  sseInit(sseHeartbeatMs?: number): void {
    if (this.headersSent) return;
    this.headersSent = true;
    this.isStreaming = true;
    this.sseStarted = true;
    this.sseHeartbeatMs = sseHeartbeatMs;
    this._headers['content-type'] = 'text/event-stream';
    this._headers['cache-control'] = 'no-cache';
    this._headers['connection'] = 'keep-alive';
    // No heartbeat interval is scheduled — a live timer would keep the test
    // process alive. The requested interval is captured in sseHeartbeatMs.
  }

  sseSend(data: unknown, event?: string): void {
    if (!this.headersSent) this.sseInit();
    this.sseEvents.push(event === undefined ? { data } : { data, event });

    // Frame exactly like NativeResponse.sseSend() so `body` shows the raw
    // wire format an EventSource client would receive.
    const parts: string[] = [];
    if (event) parts.push('event: ', event, '\n');
    if (data !== undefined && data !== null) {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      for (const line of serialized.split('\n')) {
        parts.push('data: ', line, '\n');
      }
    }
    parts.push('\n');
    this._sseText += parts.join('');
  }

  get onStreamClose(): (() => void) | null {
    return this._onStreamClose;
  }

  set onStreamClose(cb: (() => void) | null) {
    this._onStreamClose = cb ?? null;
    // The dispatcher assigns this AFTER app.handle()'s try block — for an
    // in-memory stream that already ended, fire immediately so onClose
    // hooks still run exactly once.
    if (cb && this._streamEnded) {
      this._onStreamClose = null;
      cb();
    }
  }

  // ─── Inject result surface ──────────────────────────────────────────────────

  /**
   * Response headers with lowercase names. `set-cookie` is always an array
   * of raw Set-Cookie lines (RFC 6265 forbids folding them into one header).
   */
  get headers(): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = { ...this._headers };
    const lines = this._allSetCookieLines();
    if (lines.length > 0) out['set-cookie'] = lines;
    return out;
  }

  /** Raw response body string (SSE responses show the framed event text). */
  get body(): string {
    return this.sseStarted ? this._sseText : this._body;
  }

  /** Parse the response body as JSON. */
  json<T = unknown>(): T {
    try {
      return JSON.parse(this.body) as T;
    } catch (err) {
      throw new Error(
        `[@axiomify/testing] res.json() failed to parse the response body as JSON ` +
          `(status ${this.statusCode}, content-type ${this._headers['content-type'] ?? 'unset'}): ` +
          `${(err as Error).message}. Body: ${JSON.stringify(this.body.slice(0, 200))}`,
      );
    }
  }

  /** Structured parse of every `Set-Cookie` response header. */
  get cookies(): ParsedSetCookie[] {
    return this._allSetCookieLines().map(parseSetCookie);
  }

  /** Error emitted by a streamed readable, if any. */
  get streamError(): Error | null {
    return this._streamError;
  }

  /** True once the response is fully produced (body finalized). */
  get completed(): boolean {
    return this._completed;
  }

  /** Resolves once the response body is fully produced. */
  waitForCompletion(): Promise<void> {
    if (this._completed) return Promise.resolve();
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private _allSetCookieLines(): string[] {
    // res.header('Set-Cookie', ...) writes into _headers; merge it with the
    // cookie()/clearCookie() accumulator so nothing is dropped.
    const direct = this._headers['set-cookie'];
    return direct === undefined
      ? [...this._setCookies]
      : [direct, ...this._setCookies];
  }

  private _finish(): void {
    if (this._completed) return;
    this._completed = true;
    const waiters = this._waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
