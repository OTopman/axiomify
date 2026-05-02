import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { randomUUID } from 'crypto';
import uWS from 'uWebSockets.js';
import { assertNoNativeSseRoutes } from './sse-guard';

// RFC 7231 + common extensions
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

function statusLine(code: number): string {
  return `${code} ${HTTP_STATUS_PHRASES[code] ?? 'Unknown'}`;
}

function serialize(serializer: SerializerFn, input: SerializerInput): any {
  return serializer.length <= 1
    ? (serializer as (input: SerializerInput) => any)(input)
    : (serializer as any)(
        input.data,
        input.message,
        input.statusCode,
        input.isError,
        input.req,
      );
}

// --- 1. THE FAST REQUEST SHAPE ---
class NativeRequest implements AxiomifyRequest {
  public method: HttpMethod;
  public url: string;
  public path: string;
  public ip: string;
  public headers: Record<string, string>;
  public body: any;
  public params: Record<string, string> = {};
  public state: Record<string, any> = {};
  public raw: any = { req: null, res: null };
  public stream: any = null;

  private _queryStr: string;
  private _parsedQuery?: Record<string, string>;
  private _id?: string;

  constructor(
    method: HttpMethod,
    url: string,
    ip: string,
    headers: Record<string, string>,
    queryStr: string,
    body: any,
  ) {
    this.method = method;
    this.url = url;
    this.path = url;
    this.ip = ip;
    this.headers = headers;
    this._queryStr = queryStr;
    this.body = body;
  }

  get id() {
    if (!this._id) this._id = randomUUID();
    return this._id;
  }

  get query() {
    if (!this._parsedQuery) {
      this._parsedQuery = {};
      if (this._queryStr) {
        const searchParams = new URLSearchParams(this._queryStr);
        searchParams.forEach((v, k) => {
          this._parsedQuery![k] = v;
        });
      }
    }
    return this._parsedQuery;
  }
}

// --- 2. THE FAST RESPONSE SHAPE ---
class NativeResponse implements AxiomifyResponse {
  public statusCode = 200;
  public headersSent = false;
  public raw: any;
  public aborted = false;

  private app: Axiomify;
  private req: NativeRequest;
  private outHeaders = new Map<string, string>();

  constructor(res: any, app: Axiomify, req: NativeRequest) {
    this.raw = res;
    this.app = app;
    this.req = req;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  header(key: string, value: string) {
    this.outHeaders.set(key, value);
    return this;
  }
  getHeader(key: string) {
    return this.outHeaders.get(key);
  }

  removeHeader(key: string) {
    this.outHeaders.delete(key);
    return this;
  }

  send<T>(data: T, message?: string) {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    (this as any).payload = this.app.serializer({
      data,
      message,
      statusCode: this.statusCode,
      isError: false,
      req: this.req,
    });
    const jsonString = JSON.stringify((this as any).payload);

    this.raw.cork(() => {
      this.raw.writeStatus(statusLine(this.statusCode));
      this.raw.writeHeader('Content-Type', 'application/json');
      for (const [k, v] of this.outHeaders.entries()) {
        this.raw.writeHeader(k, v);
      }
      this.raw.end(jsonString);
    });
  }

  sendRaw(payload: any, contentType = 'text/plain') {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    this.raw.cork(() => {
      this.raw.writeStatus(statusLine(this.statusCode));
      this.raw.writeHeader('Content-Type', contentType);
      for (const [k, v] of this.outHeaders.entries()) {
        this.raw.writeHeader(k, v);
      }
      this.raw.end(payload);
    });
  }

  error(err: unknown) {
    this.status(500).send(err, 'Internal Error');
  }

  stream(readable: import('stream').Readable) {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    this.raw.cork(() => {
      this.raw.writeStatus(statusLine(this.statusCode));
      // Stream size is unknown up-front; force chunked transfer semantics.
      this.raw.writeHeader('Transfer-Encoding', 'chunked');
      for (const [k, v] of this.outHeaders.entries()) {
        this.raw.writeHeader(k, v);
      }
    });

    const pending: Buffer[] = [];
    let flushing = false;

    const flush = () => {
      if (this.aborted) return true;
      while (pending.length > 0) {
        const chunk = pending[0];
        const ok = this.raw.write(chunk);
        if (!ok) {
          readable.pause();
          if (!flushing) {
            flushing = true;
            this.raw.onWritable(() => {
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

    readable.on('data', (chunk) => {
      pending.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      flush();
    });

    readable.on('end', () => {
      if (this.aborted) return;
      if (flush()) this.raw.end();
      else {
        this.raw.onWritable(() => {
          if (flush()) {
            this.raw.end();
            return true;
          }
          return false;
        });
      }
    });
  }

  sseInit() {
    throw new Error(
      '[Axiomify/native] NativeAdapter does not support Server-Sent Events (SSE). Use @axiomify/http, @axiomify/express, @axiomify/fastify, or @axiomify/hapi for SSE endpoints.',
    );
  }
  sseSend() {
    throw new Error(
      '[Axiomify/native] NativeAdapter does not support Server-Sent Events (SSE). Use @axiomify/http, @axiomify/express, @axiomify/fastify, or @axiomify/hapi for SSE endpoints.',
    );
  }
}

type WsUserData = { url: string; headers: Record<string, string> };

export interface NativeWsOptions {
  /** Path to bind the WebSocket endpoint on. Defaults to '/ws'. */
  path?: string;
  compression?: number;
  maxPayloadLength?: number;
  idleTimeout?: number;
  open?: (ws: any) => void;
  message?: (
    ws: any,
    message: ArrayBuffer,
    isBinary: boolean,
  ) => void;
  close?: (
    ws: any,
    code: number,
    message: ArrayBuffer,
  ) => void;
}

export interface NativeAdapterOptions {
  port?: number;
  /**
   * Maximum request body size in bytes. Requests whose buffered body exceeds
   * this value are aborted with a 413 response. Defaults to 1 MiB.
   */
  maxBodySize?: number;
  /**
   * WebSocket endpoint configuration. Set to `false` to disable the WS
   * endpoint entirely. When omitted, no WS endpoint is registered.
   */
  ws?: NativeWsOptions | false;
}

function readBody(
  res: any,
  contentType: string = '',
  maxBodySize: number,
): Promise<{ body: any; tooLarge: boolean }> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let tooLarge = false;

    res.onData((ab: ArrayBuffer, isLast: boolean) => {
      if (tooLarge) return;

      const chunk = Buffer.from(ab);
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length > maxBodySize) {
        tooLarge = true;
        if (isLast) resolve({ body: undefined, tooLarge: true });
        return;
      }

      if (isLast) {
        if (buffer.length === 0)
          return resolve({ body: undefined, tooLarge: false });

        if (contentType.includes('application/json')) {
          try {
            resolve({ body: JSON.parse(buffer.toString()), tooLarge: false });
          } catch {
            resolve({ body: undefined, tooLarge: false });
          }
        } else {
          resolve({ body: buffer, tooLarge: false });
        }
      }
    });
  });
}

export class NativeAdapter {
  private app: Axiomify;
  private port: number;
  private server: any;
  private listenSocket: any = null;
  private readonly maxBodySize: number;

  constructor(app: Axiomify, options: NativeAdapterOptions = {}) {
    this.app = app;
    this.port = options.port || 3000;
    this.maxBodySize = options.maxBodySize ?? 1024 * 1024;
    assertNoNativeSseRoutes(this.app.registeredRoutes);
    this.server = uWS.App();

    if (options.ws !== false && options.ws !== undefined) {
      this.registerWs(options.ws);
    }
  }

  private registerWs(opts: NativeWsOptions): void {
    const wsPath = opts.path ?? '/ws';

    this.server.ws(wsPath, {
      compression: opts.compression ?? uWS.SHARED_COMPRESSOR,
      maxPayloadLength: opts.maxPayloadLength ?? 16 * 1024 * 1024,
      idleTimeout: opts.idleTimeout ?? 120,

      upgrade: (res: any, req: any, context: any) => {
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

        res.onAborted(() => {});

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

      open: opts.open ?? (() => {}),
      message: opts.message ?? (() => {}),
      close: opts.close ?? (() => {}),
    });
  }

  public listen(callback?: () => void, onError?: (err: Error) => void): void {
    this.server.any('/*', (res: any, req: any) => {
      let aborted = false;
      res.onAborted(() => {
        aborted = true;
      });

      const url = req.getUrl();
      const method = req.getMethod().toUpperCase() as any;
      const queryStr = req.getQuery();

      const headers: Record<string, string> = {};
      req.forEach((k: string, v: string) => {
        headers[k] = v;
      });
      const ip = Buffer.from(res.getRemoteAddressAsText()).toString();

      (async () => {
        let body: any = undefined;
        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          const result = await readBody(
            res,
            headers['content-type'],
            this.maxBodySize,
          );
          if (result.tooLarge) {
            if (!aborted) {
              res.cork(() => {
                res.writeStatus(statusLine(413));
                res.writeHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    status: 'failed',
                    message: 'Payload Too Large',
                    data: null,
                  }),
                );
              });
            }
            return;
          }
          body = result.body;
        }

        if (aborted) return;

        const axiomifyReq = new NativeRequest(
          method,
          url,
          ip,
          headers,
          queryStr,
          body,
        );
        const axiomifyRes = new NativeResponse(res, this.app, axiomifyReq);
        axiomifyRes.aborted = aborted;

        await this.app.handle(axiomifyReq, axiomifyRes);
      })();
    });

    this.server.listen(this.port, (token: unknown) => {
      if (token) {
        this.listenSocket = token;
        if (callback) callback();
      } else {
        const err = new Error(`[Axiomify] Port ${this.port} is occupied.`);
        if (onError) {
          onError(err);
          return;
        }
        // Defer throw so it surfaces as an uncaught exception instead of
        // terminating process abruptly via process.exit().
        queueMicrotask(() => {
          throw err;
        });
      }
    });
  }

  public close(): void {
    if (this.listenSocket) {
      uWS.us_listen_socket_close(this.listenSocket);
      this.listenSocket = null;
    }
  }
}

export { adaptMiddleware } from './bridge';
