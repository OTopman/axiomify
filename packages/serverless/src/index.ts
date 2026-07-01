import {
  ADAPTER_LOCK_TOKEN,
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  RequestStateImpl,
} from '@axiomify/core';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';

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

  constructor(
    private readonly app: Axiomify,
    options: ServerlessAdapterOptions = {},
  ) {
    this.app.lockRoutes(ADAPTER_LOCK_TOKEN, '@axiomify/serverless');
    this._maxBodySize = options.maxBodySize ?? 1_048_576;
    this._trustProxy = options.trustProxy ?? false;
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
      // Reject early on the declared Content-Length, then re-check the
      // actual byte length after reading in case the header lied.
      const contentLength = Number(headers['content-length'] as string);
      if (Number.isFinite(contentLength) && contentLength > this._maxBodySize) {
        return new Response('Payload Too Large', { status: 413 });
      }
      try {
        const ab = await request.arrayBuffer();
        rawBody = Buffer.from(ab);
      } catch {
        // Fallback to empty/null if reading body fails
      }
      if (rawBody && rawBody.length > this._maxBodySize) {
        return new Response('Payload Too Large', { status: 413 });
      }
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

          if (data === null || data === undefined) {
            responseBody = null;
          } else if (typeof data === 'string') {
            responseBody = data;
            if (!responseHeaders.has('content-type')) {
              responseHeaders.set('content-type', 'text/plain; charset=utf-8');
            }
          } else {
            responseBody = JSON.stringify(data);
            if (!responseHeaders.has('content-type')) {
              responseHeaders.set('content-type', 'application/json; charset=utf-8');
            }
          }

          resolve(
            new Response(responseBody, {
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
