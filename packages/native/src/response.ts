import type {
  Axiomify,
  AxiomifyResponse,
  CookieOptions,
  HttpMethod,
  ResponseCapabilities,
  SerializerInput,
} from "@axiomify/core";
import { serializeCookie } from "@axiomify/core";
import type { HttpResponse as UWSResponse } from "uWebSockets.js";
import { ErrorCache, statusLine } from "./error-cache";
import { HEADER_INJECTION_PATTERN } from "./headers";
import type { NativeRequest } from "./request";

const NATIVE_CAPABILITIES: ResponseCapabilities = {
  sse: true,
  streaming: true,
};

/**
 * `AxiomifyResponse` implementation backed by uWebSockets.js.
 *
 * Hot-path notes:
 *   - `cork()` batches all writes to a single TCP segment. Every `send`,
 *     `sendRaw`, `stream`, and `sseInit` corks before writing.
 *   - The serializer input object is pre-allocated per response and mutated
 *     in place — no allocation per send call. The contract assumes the
 *     serializer is synchronous (enforced by `makeSerialize`'s probe).
 *   - `headers` is a plain object, not a Map. Responses with ≤10 headers
 *     are faster with object lookups in V8; the upper bound from real apps
 *     is much smaller than the cutoff where Map wins.
 *   - Both streaming paths (HTTP chunked + SSE) bound their pending-bytes
 *     buffer so a slow client can't OOM the process.
 */
export class NativeResponse implements AxiomifyResponse {
  public statusCode = 200;
  public headersSent = false;
  public aborted = false;
  public isStreaming = false;
  public onStreamClose: (() => void) | null = null;
  public raw: UWSResponse;
  public readonly capabilities: ResponseCapabilities = NATIVE_CAPABILITIES;
  public payload?: unknown;
  public responseMessage?: string;

  private readonly _app: Axiomify;
  private readonly _req: NativeRequest;
  private readonly _method: HttpMethod;
  private readonly _serialize: (input: SerializerInput) => unknown;
  private readonly _errorCache: ErrorCache;
  // Plain object beats Map for the small-header common case.
  private _headers: Record<string, string> = {};
  // Set-Cookie lines are kept out of _headers: RFC 6265 forbids folding
  // multiple cookies into one header, so they need their own list. Lazily
  // allocated — most responses set no cookies.
  private _cookies: string[] | null = null;
  // Pre-allocated serializer input bag — mutated in place on every send()
  // instead of allocating a new object per response. Safe because _serialize
  // is always called synchronously within send(), with no re-entrancy risk
  // (makeSerialize() probes for async returns and throws at construction).
  private readonly _serializeInput: SerializerInput;

  // SSE backpressure state. SSE_PENDING_BYTE_CAP is smaller than the stream
  // cap because SSE events are typically tiny — 1 MiB of buffered events
  // represents thousands of dropped seconds for a busy stream.
  private static readonly SSE_PENDING_BYTE_CAP = 1 * 1024 * 1024;
  private _pendingSse: string[] = [];
  private _pendingSseBytes = 0;
  private _flushingSse = false;

  private readonly _onHeadersSent?: () => void;

  constructor(
    res: UWSResponse,
    app: Axiomify,
    req: NativeRequest,
    method: HttpMethod,
    serialize: (input: SerializerInput) => unknown,
    errorCache: ErrorCache,
    onHeadersSent?: () => void
  ) {
    this.raw = res;
    this._app = app;
    this._req = req;
    this._method = method;
    this._serialize = serialize;
    this._errorCache = errorCache;
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
    // Reject CR/LF/NUL in header names and values. uWS's writeHeader does
    // not validate this and would pass `\r\n` straight through, producing
    // a response-splitting / header-injection foothold:
    //
    //   res.header('X-Foo', 'bar\r\nSet-Cookie: pwned=1')
    //
    // would split the response and inject an attacker-controlled cookie.
    // Throwing here is correct per RFC 9110 §5.5 — invalid characters MUST
    // NOT appear in field values.
    if (
      HEADER_INJECTION_PATTERN.test(key) ||
      HEADER_INJECTION_PATTERN.test(value)
    ) {
      throw new Error(
        `[Axiomify/native] header() rejected CR/LF in name or value ` +
          `(response splitting prevention). Strip control characters before ` +
          `passing user-controlled data to res.header().`
      );
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
    // serializeCookie validates name/value/attributes (including the CR/LF
    // injection class header() guards against) and throws on bad input.
    (this._cookies ??= []).push(serializeCookie(name, value, options));
    return this;
  }

  clearCookie(
    name: string,
    options?: Pick<CookieOptions, "domain" | "path" | "secure" | "sameSite">
  ): this {
    return this.cookie(name, "", {
      ...options,
      expires: new Date(0),
      maxAge: 0,
    });
  }

  private _writeCookies(): void {
    if (this._cookies === null) return;
    for (let i = 0; i < this._cookies.length; i++) {
      this.raw.writeHeader("Set-Cookie", this._cookies[i]);
    }
  }

  send<T>(data: T, message?: string): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;
    this._onHeadersSent?.();

    // Mutate the pre-allocated input bag rather than allocating a new
    // object. _serialize is synchronous-by-contract.
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
      this.raw.writeHeader("Content-Type", "application/json");
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      this._writeCookies();
      // HEAD responses: send headers only, no body.
      this.raw.end(this._method === "HEAD" ? "" : body);
    });
  }

  sendRaw(payload: unknown, contentType = "text/plain"): void {
    if (this.headersSent || this.aborted) return;
    if (HEADER_INJECTION_PATTERN.test(contentType)) {
      throw new Error(
        `[Axiomify/native] sendRaw() rejected CR/LF in contentType (response splitting prevention).`
      );
    }
    this.headersSent = true;
    this._onHeadersSent?.();

    const body =
      typeof payload === "string"
        ? payload
        : Buffer.isBuffer(payload)
        ? payload
        : String(payload);
    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader("Content-Type", contentType);
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      this._writeCookies();
      this.raw.end(body as string);
    });
  }

  stream(
    readable: import("stream").Readable,
    contentType = "application/octet-stream"
  ): void {
    if (this.headersSent || this.aborted) return;
    if (HEADER_INJECTION_PATTERN.test(contentType)) {
      throw new Error(
        `[Axiomify/native] stream() rejected CR/LF in contentType (response splitting prevention).`
      );
    }
    this.headersSent = true;
    this._onHeadersSent?.();
    this.isStreaming = true;

    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader("Content-Type", contentType);
      this.raw.writeHeader("Transfer-Encoding", "chunked");
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      this._writeCookies();
    });

    // Cap pending bytes under backpressure. A slow client with TCP window=0
    // would otherwise let the application's source readable accumulate in
    // `pending` without bound — OOM in minutes for any video/log stream.
    // The pause/resume mechanism mitigates throughput but cannot defend
    // against a misbehaving source that ignores pause(); the hard cap below
    // protects memory regardless.
    const PENDING_BYTE_CAP = 8 * 1024 * 1024; // 8 MiB per response
    const pending: Uint8Array[] = [];
    let pendingBytes = 0;
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
            chunk.byteOffset + chunk.byteLength
          ) as ArrayBuffer
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
        pendingBytes -= chunk.byteLength;
      }
      return true;
    };

    readable.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (pendingBytes + buf.byteLength > PENDING_BYTE_CAP) {
        // Source is producing faster than the client can drain. Better to
        // kill one slow connection than to OOM the process.
        readable.destroy(
          new Error(
            `[Axiomify/native] response stream exceeded pending-bytes cap ` +
              `(${PENDING_BYTE_CAP}). Client is too slow or not consuming.`
          )
        );
        return;
      }
      pending.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      pendingBytes += buf.byteLength;
      flush();
    });

    readable.on("end", () => {
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

    readable.on("error", () => {
      if (!self.aborted) res.end();
    });

    if (this._req.signal.aborted) {
      readable.destroy();
    } else {
      const abortListener = () => {
        readable.destroy();
      };
      this._req.signal.addEventListener("abort", abortListener);
      readable.on("close", () => {
        this._req.signal.removeEventListener("abort", abortListener);
        self.onStreamClose?.();
      });
    }
  }

  sseInit(sseHeartbeatMs?: number): void {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;
    this._onHeadersSent?.();

    const sl = statusLine(this.statusCode);
    const headers = this._headers;

    this.raw.cork(() => {
      this.raw.writeStatus(sl);
      this.raw.writeHeader("Content-Type", "text/event-stream");
      this.raw.writeHeader("Cache-Control", "no-cache");
      this.raw.writeHeader("Connection", "keep-alive");
      for (const k in headers) {
        this.raw.writeHeader(k, headers[k]);
      }
      this._writeCookies();
    });

    if (sseHeartbeatMs) {
      const interval = setInterval(() => {
        this.sseSend(null, "ping");
      }, sseHeartbeatMs);
      this._req.signal.addEventListener("abort", () => clearInterval(interval));
    }

    // Support onClose hooks similar to streams
    this.isStreaming = true;
    const abortListener = () => {
      this.onStreamClose?.();
    };
    this._req.signal.addEventListener("abort", abortListener);
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
      this._pendingSseBytes -= chunk.length;
    }
    return true;
  }

  sseSend(data: any, event?: string): void {
    if (this.aborted) return;
    if (!this.headersSent) {
      this.sseInit();
    }

    // Build payload via array.join — repeated `payload += ...` reallocates
    // a fresh string per concat, which is O(n²) for large multi-line data.
    const parts: string[] = [];
    if (event) {
      parts.push("event: ", event, "\n");
    }
    if (data !== undefined && data !== null) {
      const serialized = typeof data === "string" ? data : JSON.stringify(data);
      // SSE field framing: every line of `data` becomes its own `data: ...`
      // line. `split('\n')` then re-emit is correct per the EventSource spec.
      const lines = serialized.split("\n");
      for (const line of lines) {
        parts.push("data: ", line, "\n");
      }
    }
    parts.push("\n");
    const payload = parts.join("");

    if (
      this._pendingSseBytes + payload.length >
      NativeResponse.SSE_PENDING_BYTE_CAP
    ) {
      // Slow consumer: a client that doesn't drain its TCP buffer would let
      // _pendingSse grow without bound. EventSource spec mandates client
      // auto-reconnect with Last-Event-ID, so closing here is recoverable.
      this.aborted = true;
      try {
        this.raw.cork(() => this.raw.end());
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
