import type { AxiomifyRequest, HttpMethod, RequestState } from '@axiomify/core';
import { parseCookieHeader, RequestStateImpl } from '@axiomify/core';
import { Readable } from 'stream';
import type {
  HttpRequest as UWSRequest,
  HttpResponse as UWSResponse,
} from 'uWebSockets.js';
import { fastParseQuery } from './query';

// Process-local atomic counter for request IDs.
// Faster than randomUUID() (0.049µs vs 0.137µs) and unique within the process lifetime.
// When a gateway injects X-Request-Id, the counter is bypassed entirely.
let _nativeReqCounter = 0;
const _nativePidHex = process.pid.toString(36);

/**
 * Allocation-minimal `AxiomifyRequest` implementation for `@axiomify/native`.
 *
 * Design notes:
 *   - `params`, `_parsedQuery`, `_controller`, `_id` are lazy — never
 *     allocated for requests that don't read them. Saves ~3µs/req on the
 *     no-body GET hot path.
 *   - `headers` is `Record<string, string | string[]>` (not bare `string`)
 *     because uWS can fire `req.forEach` multiple times for repeated header
 *     names. Coalescing them as arrays is the only spec-compliant shape;
 *     see `collectHeaders()` in `headers.ts`.
 *   - `signal` constructs an `AbortController` only on first read. If the
 *     request aborted before the handler accessed `.signal`, the controller
 *     is created and immediately aborted — the listener registered after the
 *     fact still fires synchronously via the AbortController's pending-abort
 *     semantics.
 */
export class NativeRequest implements AxiomifyRequest {
  public method: HttpMethod;
  public url: string;
  public path: string;
  public ip: string;
  public headers: Record<string, string | string[]>;
  public body: unknown;
  public params: Record<string, string> = Object.create(null);
  public state: RequestState = new RequestStateImpl();
  public raw: { req: UWSRequest | null; res: UWSResponse | null } = {
    req: null,
    res: null,
  };
  public stream: Readable = new Readable({ read() {} });

  private _queryStr: string;
  private _parsedQuery?: Record<string, string | string[]>;
  private _cookies?: Record<string, string>;
  private _id?: string;
  private _controller?: AbortController;
  private _aborted = false;

  constructor(
    method: HttpMethod,
    url: string,
    ip: string,
    headers: Record<string, string | string[]>,
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
      // x-request-id MUST be a single value; if a client/proxy sent it
      // multiple times take the first (RFC-permissible) value. Anything
      // else collapses to a generated id.
      const raw = this.headers['x-request-id'];
      const upstream = Array.isArray(raw) ? raw[0] : raw;
      this._id =
        upstream ?? `${_nativePidHex}-${(++_nativeReqCounter).toString(36)}`;
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
