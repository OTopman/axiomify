import type {
  AxiomifyRequest,
  HttpMethod,
  RequestState,
} from '@axiomify/core';
import { parseCookieHeader, RequestStateImpl } from '@axiomify/core';
import { Readable } from 'node:stream';

// Process-local counter — mirrors NativeRequest's id scheme so log output
// from code under test looks the same as it does in production.
let _testReqCounter = 0;
const _testPidHex = process.pid.toString(36);

export interface TestRequestInit {
  method: HttpMethod;
  /** Full request URL (path + query string). */
  url: string;
  /** Path portion only (no query string). */
  path: string;
  /** Raw query string (no leading `?`). */
  queryString: string;
  /** Header map with lowercase keys. */
  headers: Record<string, string | string[] | undefined>;
  /** Parsed body, exactly as an adapter would hand it to the dispatcher. */
  body: unknown;
  /** Raw body bytes — exposed via `req.stream`. */
  rawBody: Buffer;
  ip: string;
  /** Entries pre-populated into `req.state` before dispatch. */
  state?: Record<string, unknown>;
}

/**
 * Spec-faithful `AxiomifyRequest` used by `createTestClient().inject()`.
 *
 * Mirrors `NativeRequest` semantics:
 *   - lazy query parsing with `URLSearchParams` multi-value behavior
 *     (`?tag=a&tag=b` → `{ tag: ['a', 'b'] }`)
 *   - lazy cookie parsing from the `Cookie` header via core's
 *     `parseCookieHeader`
 *   - write-once `RequestStateImpl` state
 *   - `req.stream` is a `Readable` over the raw body bytes
 *   - lazy `AbortSignal`
 */
export class TestRequest implements AxiomifyRequest {
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly path: string;
  public readonly ip: string;
  public readonly headers: Record<string, string | string[] | undefined>;
  public body: unknown;
  public params: Record<string, string> = Object.create(null);
  public readonly state: RequestState = new RequestStateImpl();
  public readonly raw: unknown = null;
  public readonly stream: Readable;

  private readonly _queryString: string;
  private _parsedQuery?: unknown;
  private _cookies?: Record<string, string>;
  private _id?: string;
  private _controller?: AbortController;

  constructor(init: TestRequestInit) {
    this.method = init.method;
    this.url = init.url;
    this.path = init.path;
    this.ip = init.ip;
    this.headers = init.headers;
    this.body = init.body;
    this._queryString = init.queryString;
    this.stream = Readable.from(
      init.rawBody.byteLength > 0 ? [init.rawBody] : [],
    );

    if (init.state) {
      for (const [key, value] of Object.entries(init.state)) {
        this.state.set(key, value);
      }
    }
  }

  get id(): string {
    if (!this._id) {
      const raw = this.headers['x-request-id'];
      const upstream = Array.isArray(raw) ? raw[0] : raw;
      this._id =
        upstream ?? `test-${_testPidHex}-${(++_testReqCounter).toString(36)}`;
    }
    return this._id;
  }

  /**
   * Lazy query parsing. Multi-value keys are preserved as `string[]`,
   * matching the native adapter's `fastParseQuery` behavior.
   */
  get query(): unknown {
    if (this._parsedQuery === undefined) {
      const out: Record<string, string | string[]> = Object.create(null);
      const params = new URLSearchParams(this._queryString);
      for (const [key, value] of params) {
        const prev = out[key];
        if (prev === undefined) out[key] = value;
        else if (Array.isArray(prev)) prev.push(value);
        else out[key] = [prev, value];
      }
      this._parsedQuery = out;
    }
    return this._parsedQuery;
  }

  // The validation pipeline assigns the Zod-parsed (coerced) query back.
  set query(value: unknown) {
    this._parsedQuery = value;
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

  /** Lazy AbortSignal — mirrors NativeRequest. Use `abort()` to trigger. */
  get signal(): AbortSignal {
    if (!this._controller) {
      this._controller = new AbortController();
    }
    return this._controller.signal;
  }

  /** Simulate a client disconnect mid-request. */
  abort(reason?: unknown): void {
    this._controller ??= new AbortController();
    this._controller.abort(reason ?? new Error('Client aborted request'));
  }
}
