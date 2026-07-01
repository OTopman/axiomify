import {
  ADAPTER_LOCK_TOKEN,
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  makeSerialize,
  RequestStateImpl,
  type SerializerInput,
} from '@axiomify/core';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';

// Statuses that must not carry a response body per the Fetch spec — the
// Response constructor throws if a non-null body is supplied for these.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export interface ServerlessAdapterOptions {
  /**
   * Maximum request body size in bytes. Requests exceeding this are
   * rejected with 413 before parsing. Matches the native adapter default.
   * @default 1 MiB (1_048_576)
   */
  maxBodySize?: number;
  /**
   * When true, derive the client IP from the `X-Forwarded-For` header.
   * Only enable behind a trusted proxy, as the header is client-spoofable.
   * @default false
   */
  trustProxy?: boolean;
}

export class ServerlessAdapter {
  private readonly _lockToken = ADAPTER_LOCK_TOKEN;
  private readonly _maxBodySize: number;
  private readonly _trustProxy: boolean;
  private readonly _serialize: (input: SerializerInput) => unknown;

  constructor(
    private readonly app: Axiomify,
    options: ServerlessAdapterOptions = {},
  ) {
    this.app.lockRoutes(ADAPTER_LOCK_TOKEN, '@axiomify/serverless');
    this._maxBodySize = options.maxBodySize ?? 1_048_576;
    this._trustProxy = options.trustProxy ?? false;
    // Capture the configured serializer after routes are locked, mirroring the
    // native adapter, so serverless responses share the same envelope shape.
    this._serialize = makeSerialize(this.app.serializer);
  }

  /**
   * Reads the request body while enforcing `maxBodySize`. When the body is a
   * readable stream it is consumed chunk-by-chunk and aborted as soon as the
   * accumulated size exceeds the cap — the full payload is never buffered.
   * Falls back to `arrayBuffer()` (then a post-read check) only on runtimes
   * that don't expose a streamable `request.body`.
   */
  private async readBodyWithLimit(
    request: Request,
  ): Promise<{ overLimit: boolean; buffer: Buffer | null }> {
    const stream = request.body as ReadableStream<Uint8Array> | null;
    if (stream && typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > this._maxBodySize) {
            await reader.cancel().catch(() => {});
            return { overLimit: true, buffer: null };
          }
          chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        }
      } catch {
        // Reading failed — treat as an empty body.
        return { overLimit: false, buffer: null };
      }
      return { overLimit: false, buffer: chunks.length ? Buffer.concat(chunks, total) : null };
    }

    // Fallback: no streamable body — buffer, then check.
    try {
      const buf = Buffer.from(await request.arrayBuffer());
      if (buf.length > this._maxBodySize) {
        return { overLimit: true, buffer: null };
      }
      return { overLimit: false, buffer: buf };
    } catch {
      return { overLimit: false, buffer: null };
    }
  }

  public async handle(request: Request): Promise<Response> {
    const method = (request.method || 'GET').toUpperCase() as any;
    const parsedUrl = new URL(request.url);
    const path = parsedUrl.pathname;
    const url = parsedUrl.pathname + parsedUrl.search;

    // Parse query params
    const query: Record<string, string | string[]> = {};
    for (const [key, val] of parsedUrl.searchParams.entries()) {
      const existing = query[key];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          query[key] = [existing, val];
        }
      } else {
        query[key] = val;
      }
    }

    const headers: Record<string, string | string[]> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Read body if method allows payload
    const hasBody = request.body && !['GET', 'HEAD'].includes(method);
    let rawBody: Buffer | null = null;
    let body: unknown = null;
    if (hasBody) {
      // M5 (CWE-400): cap request body size to avoid unbounded buffering.
      // Cheap fast-path — reject on a declared Content-Length over the cap.
      const contentLength = Number(headers['content-length'] as string);
      if (Number.isFinite(contentLength) && contentLength > this._maxBodySize) {
        return new Response('Payload Too Large', { status: 413 });
      }
      // Then read the body incrementally and abort the moment it crosses the
      // cap, so a streamed or Content-Length-underreporting client cannot
      // force the whole payload to be materialized before the check runs.
      const read = await this.readBodyWithLimit(request);
      if (read.overLimit) {
        return new Response('Payload Too Large', { status: 413 });
      }
      rawBody = read.buffer;
    }

    if (rawBody && rawBody.length > 0) {
      const contentType = (headers['content-type'] as string || '').toLowerCase();
      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(rawBody.toString('utf8'));
        } catch {
          body = undefined;
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody.toString('utf8'));
        const parsed: Record<string, string | string[]> = {};
        for (const [key, val] of params.entries()) {
          const existing = parsed[key];
          if (existing !== undefined) {
            if (Array.isArray(existing)) {
              existing.push(val);
            } else {
              parsed[key] = [existing, val];
            }
          } else {
            parsed[key] = val;
          }
        }
        body = parsed;
      } else {
        body = rawBody;
      }
    }

    // L2 (CWE-348): X-Forwarded-For is client-controlled, so only trust it
    // when explicitly running behind a proxy. Otherwise do not populate ip
    // from the header (the Fetch Request API exposes no socket-level source).
    const ip = this._trustProxy
      ? (headers['x-forwarded-for'] as string) || ''
      : '';

    const req: AxiomifyRequest = {
      // L3 (CWE-338): use a cryptographically strong id instead of Math.random.
      id: (headers['x-request-id'] as string) || randomUUID(),
      method,
      url,
      path,
      ip,
      headers,
      body,
      query,
      params: {},
      state: new RequestStateImpl(),
      raw: request,
      stream: rawBody ? Readable.from(rawBody) : Readable.from([]),
    };

    // Captured once per request; used by res.send to build the response
    // envelope through the app's configured serializer (see native adapter).
    const serialize = this._serialize;

    return new Promise<Response>((resolve, reject) => {
      let responseStatusCode = 200;
      const responseHeaders = new Headers();
      let responseBody: BodyInit | null = null;
      let headersSent = false;
      let isStreaming = false;

      const res: AxiomifyResponse = {
        status(code) {
          responseStatusCode = code;
          return this;
        },
        header(key, value) {
          responseHeaders.set(key, value);
          return this;
        },
        getHeader(key) {
          return responseHeaders.get(key) || undefined;
        },
        removeHeader(key) {
          responseHeaders.delete(key);
          return this;
        },
        send(data, message) {
          if (headersSent) return;
          headersSent = true;

          // Route every response through the configured serializer so the
          // envelope (status/message/data), custom serializers, and error
          // metadata are identical to the native adapter. Raw/unwrapped
          // payloads remain available via sendRaw().
          const payload = serialize({
            data,
            message,
            statusCode: responseStatusCode,
            isError: responseStatusCode >= 400,
            req,
          });

          if (payload === null || payload === undefined) {
            responseBody = null;
          } else {
            responseBody = JSON.stringify(payload);
            if (!responseHeaders.has('content-type')) {
              responseHeaders.set(
                'content-type',
                'application/json; charset=utf-8',
              );
            }
          }

          // HEAD and null-body statuses (204/205/304) must not carry a body —
          // the Fetch Response constructor throws otherwise.
          const finalBody =
            method === 'HEAD' || NULL_BODY_STATUSES.has(responseStatusCode)
              ? null
              : responseBody;

          resolve(
            new Response(finalBody, {
              status: responseStatusCode,
              headers: responseHeaders,
            })
          );
        },
        sendRaw(payload, contentType) {
          if (headersSent) return;
          headersSent = true;

          responseBody = payload;
          if (contentType) {
            responseHeaders.set('content-type', contentType);
          }

          resolve(
            new Response(responseBody, {
              status: responseStatusCode,
              headers: responseHeaders,
            })
          );
        },
        stream(readable, contentType) {
          if (headersSent) return;
          headersSent = true;
          isStreaming = true;

          if (contentType) {
            responseHeaders.set('content-type', contentType);
          }

          let streamClosed = false;
          const triggerClose = () => {
            if (!streamClosed) {
              streamClosed = true;
              if (res.onStreamClose) {
                res.onStreamClose();
              }
            }
          };

          // Create a Transform stream to coerce any string chunks into Buffers
          const binaryStream = new Transform({
            transform(chunk, encoding, callback) {
              if (typeof chunk === 'string') {
                callback(null, Buffer.from(chunk, (encoding as any) || 'utf8'));
              } else {
                callback(null, chunk);
              }
            },
          });

          readable.on('close', triggerClose);
          readable.on('end', triggerClose);
          readable.on('error', triggerClose);

          readable.pipe(binaryStream);

          const webStream = Readable.toWeb(binaryStream);
          resolve(
            new Response(webStream as any, {
              status: responseStatusCode,
              headers: responseHeaders,
            })
          );
        },
        capabilities: { sse: false, streaming: true },
        get statusCode() {
          return responseStatusCode;
        },
        raw: null,
        get headersSent() {
          return headersSent;
        },
        get isStreaming() {
          return isStreaming;
        },
        set isStreaming(val) {
          isStreaming = !!val;
        },
        onStreamClose: null,
      };

      this.app.handle(req, res).catch((err) => {
        if (!headersSent) {
          reject(err);
        }
      });
    });
  }
}
