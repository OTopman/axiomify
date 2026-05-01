import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
} from '@axiomify/core';
import { randomUUID } from 'crypto';
import uWS from 'uWebSockets.js';

export interface NativeAdapterOptions {
  port?: number;
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

  // Lazy Evaluate UUID
  get id() {
    if (!this._id) this._id = randomUUID();
    return this._id;
  }

  // Lazy Evaluate Query Strings
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
  public raw: uWS.HttpResponse;
  public aborted = false;

  private app: Axiomify;
  private req: NativeRequest;
  private outHeaders = new Map<string, string>();

  constructor(res: uWS.HttpResponse, app: Axiomify, req: NativeRequest) {
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

  removeHeader(key: string) {
    this.outHeaders.delete(key);
    return this;
  }

  send<T>(data: T, message?: string) {
    if (this.headersSent || this.aborted) return;
    this.headersSent = true;

    (this as any).payload = this.app.serializer(
      data,
      message,
      this.statusCode,
      false,
      this.req,
    );
    const jsonString = JSON.stringify((this as any).payload);

    this.raw.cork(() => {
      this.raw.writeStatus(`${this.statusCode} OK`);
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
      this.raw.writeStatus(`${this.statusCode} OK`);
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
      this.raw.writeStatus(`${this.statusCode} OK`);
      for (const [k, v] of this.outHeaders.entries()) {
        this.raw.writeHeader(k, v);
      }
    });

    readable.on('data', (chunk) => {
      // Handle uWS backpressure via tryEnd / onWritable
      const lastOffset = this.raw.getWriteOffset();
      const [ok, done] = this.raw.tryEnd(chunk, readable.readableLength);

      if (!ok) {
        readable.pause();
        this.raw.onWritable((offset) => {
          const [writeOk, writeDone] = this.raw.tryEnd(
            chunk.slice(offset - lastOffset),
            readable.readableLength,
          );
          if (writeOk) readable.resume();
          return writeOk;
        });
      }
    });

    readable.on('end', () => {
      if (!this.aborted) this.raw.end();
    });
  }
  sseInit() {
    throw new Error('SSE not yet implemented in Native');
  }
  sseSend() {}
}

function readBody(
  res: uWS.HttpResponse,
  contentType: string = '',
): Promise<any> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    res.onData((ab, isLast) => {
      const chunk = Buffer.from(ab);
      buffer = Buffer.concat([buffer, chunk]);
      if (isLast) {
        if (buffer.length === 0) return resolve(undefined);

        // Only attempt JSON parsing if the client explicitly sent JSON
        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(buffer.toString()));
          } catch {
            resolve(undefined);
          }
        } else {
          // Pass raw Buffer/String to @axiomify/upload or @axiomify/graphql
          resolve(buffer);
        }
      }
    });
  });
}

export interface NativeAdapterOptions {
  port?: number;
}

export class NativeAdapter {
  private app: Axiomify;
  private port: number;
  private server: uWS.TemplatedApp;
  private listenSocket: any = null;

  constructor(app: Axiomify, options: NativeAdapterOptions = {}) {
    this.app = app;
    this.port = options.port || 3000;
    this.server = uWS.App();
  }

  public listen(callback?: () => void): void {
    // 1. Explicitly bind to /ws instead of /* to avoid route collision
    this.server.ws('/ws', {
      compression: uWS.SHARED_COMPRESSOR,
      maxPayloadLength: 16 * 1024 * 1024,
      idleTimeout: 120,

      upgrade: (res, req, context) => {
        const url = req.getUrl();
        const secWebSocketKey = req.getHeader('sec-websocket-key');
        const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
        const secWebSocketExtensions = req.getHeader(
          'sec-websocket-extensions',
        );

        // Extract headers synchronously before yielding to the event loop
        const headers: Record<string, string> = {};
        req.forEach((k, v) => {
          headers[k] = v;
        });

        let aborted = false;
        res.onAborted(() => {
          aborted = true;
        });

        // CORKING is mandatory for successful handshake delivery in uWS
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

      open: (ws) => {
        console.log(`[Axiomify WS] Connection established`);
        ws.send('Welcome to Axiomify Native');
      },

      message: (ws, message, isBinary) => {
        ws.send(message, isBinary); // Echo
      },
    });

    // Pre-compiled by V8, retaining 100% of the speed.
    this.server.any('/*', (res, req) => {
      let aborted = false;
      res.onAborted(() => {
        aborted = true;
      });

      const url = req.getUrl();
      const method = req.getMethod().toUpperCase() as any;
      const queryStr = req.getQuery();

      const headers: Record<string, string> = {};
      req.forEach((k, v) => {
        headers[k] = v;
      });
      const ip = Buffer.from(res.getRemoteAddressAsText()).toString();

      (async () => {
        let body: any = undefined;
        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          // Assuming you implemented the Content-Type fix we discussed!
          body = await readBody(res, headers['content-type']);
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

    this.server.listen(this.port, (token) => {
      if (token) {
        this.listenSocket = token; // Save the token!
        if (callback) callback();
      } else {
        console.error(`[Axiomify] Port ${this.port} is occupied.`);
        process.exit(1);
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
