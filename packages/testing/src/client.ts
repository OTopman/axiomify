import type { Axiomify, HttpMethod, SerializerInput } from '@axiomify/core';
import { makeSerialize } from '@axiomify/core';
import { TestRequest } from './request';
import { TestResponse } from './response';

// RFC 6265 cookie-name / cookie-value patterns — identical to core's
// serializeCookie policy, applied to the *request* Cookie header we build.
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

export type QueryValue = string | number | boolean;

export interface InjectOptions {
  /** HTTP method. Defaults to `GET`. */
  method?: HttpMethod;
  /** Request URL — path with optional query string (`/users?limit=5`). */
  url: string;
  /**
   * Additional query parameters, merged with any query string in `url`.
   * Array values produce repeated keys (`{ tag: ['a','b'] }` → `tag=a&tag=b`).
   */
  query?: Record<string, QueryValue | QueryValue[]>;
  /** Request headers. Names are lowercased before dispatch. */
  headers?: Record<string, string | string[]>;
  /** Request cookies — serialized into the `Cookie` header. */
  cookies?: Record<string, string>;
  /**
   * Request body. Plain objects/arrays are auto-JSON-encoded and get a
   * `content-type: application/json` header; strings and Buffers pass
   * through verbatim (JSON strings are parsed when the content-type says so).
   */
  body?: unknown;
  /** Source IP the handler sees via `req.ip`. Defaults to `127.0.0.1`. */
  ip?: string;
  /** Entries pre-populated into `req.state` before dispatch. */
  state?: Record<string, unknown>;
  /**
   * Milliseconds to wait for the handler to produce a response before
   * rejecting. Defaults to 5000.
   */
  timeoutMs?: number;
}

/** Per-request options for the convenience verb methods. */
export type InjectVerbOptions = Omit<InjectOptions, 'method' | 'url'>;

export interface TestClientOptions {
  /** Default source IP for every injected request. */
  ip?: string;
  /** Default `req.state` entries for every injected request. */
  state?: Record<string, unknown>;
  /** Default response timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Inject-style test client for an {@link Axiomify} app — no sockets, no
 * ports, no adapter. Requests dispatch through `app.handle()`, the exact
 * entry point production adapters use, so hooks, validation, serialization
 * and error semantics all behave identically to a live server.
 */
export class TestClient {
  constructor(
    private readonly app: Axiomify,
    private readonly defaults: TestClientOptions = {},
  ) {}

  /**
   * Returns a new client whose requests have `req.state[key]` pre-populated
   * before dispatch — e.g. to simulate an authenticated user without running
   * the auth plugin. Chainable; the original client is not modified.
   */
  withState(key: string, value: unknown): TestClient {
    return new TestClient(this.app, {
      ...this.defaults,
      state: { ...this.defaults.state, [key]: value },
    });
  }

  /** Returns a new client whose requests report the given source IP. */
  withIp(ip: string): TestClient {
    return new TestClient(this.app, { ...this.defaults, ip });
  }

  /** Dispatch a request through the app and capture the response. */
  async inject(options: InjectOptions): Promise<TestResponse> {
    const method = (options.method ?? 'GET').toUpperCase() as HttpMethod;

    // ── URL / query ─────────────────────────────────────────────────────────
    const qIdx = options.url.indexOf('?');
    const path = qIdx === -1 ? options.url : options.url.slice(0, qIdx);
    const search = new URLSearchParams(
      qIdx === -1 ? '' : options.url.slice(qIdx + 1),
    );
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (Array.isArray(value)) {
          for (const v of value) search.append(key, String(v));
        } else {
          search.append(key, String(value));
        }
      }
    }
    const queryString = search.toString();
    const url = queryString ? `${path}?${queryString}` : path;

    // ── Headers (lowercased) ────────────────────────────────────────────────
    const headers: Record<string, string | string[]> = {};
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers[key.toLowerCase()] = value;
      }
    }

    // ── Cookies → Cookie header ─────────────────────────────────────────────
    if (options.cookies) {
      const pairs: string[] = [];
      for (const [name, value] of Object.entries(options.cookies)) {
        if (!COOKIE_NAME_PATTERN.test(name)) {
          throw new Error(
            `[@axiomify/testing] Invalid cookie name "${name}". ` +
              'Cookie names must be RFC 6265 tokens.',
          );
        }
        const encoded = COOKIE_VALUE_PATTERN.test(value)
          ? value
          : encodeURIComponent(value);
        pairs.push(`${name}=${encoded}`);
      }
      if (pairs.length > 0) {
        const existing = headers['cookie'];
        const prefix = Array.isArray(existing)
          ? existing.join('; ')
          : existing;
        headers['cookie'] = prefix
          ? `${prefix}; ${pairs.join('; ')}`
          : pairs.join('; ');
      }
    }

    // ── Body ────────────────────────────────────────────────────────────────
    let rawBody: Buffer = Buffer.alloc(0);
    let body: unknown = undefined;
    if (options.body !== undefined) {
      if (Buffer.isBuffer(options.body)) {
        rawBody = options.body;
        body = options.body;
      } else if (typeof options.body === 'string') {
        rawBody = Buffer.from(options.body, 'utf8');
        const ct = headers['content-type'];
        const contentType = Array.isArray(ct) ? ct[0] : ct;
        if (contentType?.includes('application/json')) {
          // Mirror what a JSON-parsing adapter hands the dispatcher.
          try {
            body = JSON.parse(options.body);
          } catch {
            body = options.body;
          }
        } else {
          body = options.body;
        }
      } else {
        // Plain object / array / number / boolean — auto-JSON.
        rawBody = Buffer.from(JSON.stringify(options.body), 'utf8');
        body = options.body;
        headers['content-type'] ??= 'application/json';
      }
      headers['content-length'] ??= String(rawBody.byteLength);
    }

    // ── Request / response pair ─────────────────────────────────────────────
    const req = new TestRequest({
      method,
      url,
      path,
      queryString,
      headers,
      body,
      rawBody,
      ip: options.ip ?? this.defaults.ip ?? '127.0.0.1',
      state: { ...this.defaults.state, ...options.state },
    });

    // Wrap the app's serializer exactly like the native adapter does at
    // construction time, so payload envelopes match production.
    const serialize = makeSerialize(this.app.serializer) as (
      input: SerializerInput,
    ) => unknown;
    const res = new TestResponse(method, serialize, req);

    // ── Dispatch, with a helpful timeout for handlers that never respond ────
    const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs ?? 5000;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `[@axiomify/testing] inject() timed out after ${timeoutMs}ms — ` +
              `${method} ${path} never produced a response. The handler must ` +
              'call res.send(), res.sendRaw(), res.stream() or res.sseInit(). ' +
              'Raise { timeoutMs } if the route is legitimately slow.',
          ),
        );
      }, timeoutMs);
    });

    const run = async (): Promise<TestResponse> => {
      await this.app.handle(req, res);
      // SSE responses stay open by design — resolve with whatever was
      // captured once the handler returns.
      if (res.sseStarted) return res;
      // Streamed or late (setTimeout-based) responses complete asynchronously.
      if (!res.completed) await res.waitForCompletion();
      return res;
    };

    try {
      return await Promise.race([run(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  get(url: string, options: InjectVerbOptions = {}): Promise<TestResponse> {
    return this.inject({ ...options, method: 'GET', url });
  }

  post(url: string, options: InjectVerbOptions = {}): Promise<TestResponse> {
    return this.inject({ ...options, method: 'POST', url });
  }

  put(url: string, options: InjectVerbOptions = {}): Promise<TestResponse> {
    return this.inject({ ...options, method: 'PUT', url });
  }

  patch(url: string, options: InjectVerbOptions = {}): Promise<TestResponse> {
    return this.inject({ ...options, method: 'PATCH', url });
  }

  delete(url: string, options: InjectVerbOptions = {}): Promise<TestResponse> {
    return this.inject({ ...options, method: 'DELETE', url });
  }

  head(url: string, options: InjectVerbOptions = {}): Promise<TestResponse> {
    return this.inject({ ...options, method: 'HEAD', url });
  }

  options(
    url: string,
    options: InjectVerbOptions = {},
  ): Promise<TestResponse> {
    return this.inject({ ...options, method: 'OPTIONS', url });
  }
}

/**
 * Create an inject-style test client for an Axiomify app.
 *
 * @example
 * const client = createTestClient(app);
 * const res = await client.post('/users', { body: { name: 'Ada' } });
 * expect(res.statusCode).toBe(201);
 * expect(res.json()).toMatchObject({ status: 'success' });
 */
export function createTestClient(
  app: Axiomify,
  options?: TestClientOptions,
): TestClient {
  return new TestClient(app, options);
}
