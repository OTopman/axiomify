import type { Axiomify, AxiomifyRequest, SerializerFn } from '@axiomify/core';
import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import http from 'http';
import { Readable } from 'stream';

function sanitize(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype')
      continue;
    clean[key] = sanitize(obj[key]);
  }
  return clean;
}

export interface HttpAdapterOptions {
  bodyLimitBytes?: number;
  /**
   * When true, derive `req.ip` from the leftmost `X-Forwarded-For` entry,
   * falling back to `socket.remoteAddress`. Only enable behind a trusted
   * reverse proxy; otherwise clients can spoof their IP.
   */
  trustProxy?: boolean;
  /**
   * Optional error sink for uncaught adapter errors. When omitted, errors
   * are silently swallowed in production and logged in development —
   * `console.error` is never used unconditionally.
   */
  onAdapterError?: (err: unknown) => void;
}

export class HttpAdapter {
  private server: http.Server;
  private readonly trustProxy: boolean;
  private readonly onAdapterError?: (err: unknown) => void;

  constructor(
    private core: Axiomify,
    options: HttpAdapterOptions = {},
  ) {
    this.trustProxy = options.trustProxy ?? false;
    this.onAdapterError = options.onAdapterError;

    this.server = http.createServer(async (req, res) => {
      try {
        const parsedBody = await this.parseBody(
          req,
          options.bodyLimitBytes ?? 1_048_576,
        );
        const axiomifyReq = this.translateRequest(req, parsedBody);
        const axiomifyRes = this.translateResponse(
          res,
          this.core.serializer,
          axiomifyReq,
        );
        await this.core.handle(axiomifyReq, axiomifyRes);
      } catch (err) {
        this.handleAdapterError(err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'failed',
              message: 'Internal Server Error',
            }),
          );
        }
      }
    });
  }

  private handleAdapterError(err: unknown): void {
    if (this.onAdapterError) {
      this.onAdapterError(err);
      return;
    }
    if (process.env.NODE_ENV !== 'production') {
      console.error('[axiomify/http] adapter error:', err);
    }
  }

  private resolveIp(req: IncomingMessage): string {
    if (this.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const value = Array.isArray(xff) ? xff[0] : xff;
      if (typeof value === 'string' && value.length > 0) {
        const first = value.split(',')[0]?.trim();
        if (first) return first;
      }
      const xri = req.headers['x-real-ip'];
      const xriValue = Array.isArray(xri) ? xri[0] : xri;
      if (typeof xriValue === 'string' && xriValue.length > 0) return xriValue;
    }
    return req.socket.remoteAddress || '0.0.0.0';
  }

  private async parseBody(
    req: IncomingMessage,
    limitBytes = 1_048_576,
  ): Promise<unknown> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;

      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        receivedBytes += chunk.length;

        if (receivedBytes > limitBytes) {
          settled = true;
          req.destroy();
          return reject(
            Object.assign(new Error('Payload Too Large'), { statusCode: 413 }),
          );
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (settled) return;
        settled = true;
        if (chunks.length === 0) return resolve(undefined);
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(sanitize(JSON.parse(body)));
        } catch {
          resolve(body);
        }
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  private translateRequest(
    req: IncomingMessage,
    parsedBody: unknown,
  ): AxiomifyRequest {
    const urlParts = (req.url || '/').split('?');
    const path = urlParts[0];
    const query = new URLSearchParams(urlParts[1] || '');

    const _params = {};
    const _state = {};
    const requestId =
      (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const ip = this.resolveIp(req);

    return {
      get id() {
        return requestId;
      },
      get method() {
        return (req.method || 'GET') as AxiomifyRequest['method'];
      },
      get url() {
        return req.url || '/';
      },
      get path() {
        return path;
      },
      get ip() {
        return ip;
      },
      get headers() {
        return req.headers as Record<string, string | string[] | undefined>;
      },
      get body() {
        return parsedBody;
      },
      get query() {
        return Object.fromEntries(query.entries());
      },
      get params() {
        return _params;
      },
      get state() {
        return _state;
      },
      get raw() {
        return req;
      },
      get stream() {
        return req;
      },
    };
  }

  private translateResponse(
    res: http.ServerResponse,
    serializer: SerializerFn,
    req: AxiomifyRequest,
  ): any {
    let statusCode = 200;
    let isSent = false;

    return {
      status(code: number) {
        statusCode = code;
        return this;
      },
      header(key: string, value: string) {
        res.setHeader(key, value);
        return this;
      },
      removeHeader(key: string) {
        res.removeHeader(key);
        return this;
      },

      send(data: any, message?: string) {
        if (isSent) return; // Idempotent — prevent double-write crashes.
        isSent = true;
        const isError = statusCode >= 400;
        const payload = serializer(data, message, statusCode, isError, req);
        if (!res.hasHeader('Content-Type')) {
          res.setHeader('Content-Type', 'application/json');
        }
        res.writeHead(statusCode);
        res.end(JSON.stringify(payload));
      },

      sendRaw(payload: any, contentType = 'text/plain') {
        if (isSent) return;
        isSent = true;
        res.setHeader('Content-Type', contentType);
        res.writeHead(statusCode);
        res.end(payload);
      },

      error(err: unknown) {
        if (isSent) return;
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = serializer(null, message, 500, true, req);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify(payload));
      },

      stream(readable: Readable, contentType = 'application/octet-stream') {
        if (isSent) return;
        isSent = true;
        res.setHeader('Content-Type', contentType);
        res.writeHead(statusCode);
        readable.pipe(res);
      },

      sseInit(sseHeartbeatMs: number = 15_000) {
        if (isSent) return;
        isSent = true;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const heartbeat = setInterval(() => {
          res.write(': keepalive\n\n');
        }, sseHeartbeatMs);
        // unref so a lingering SSE timer does not block process exit.
        heartbeat.unref();
        res.on('close', () => clearInterval(heartbeat));
      },

      sseSend(data: any, event?: string) {
        if (event) res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      },

      get statusCode() {
        return statusCode;
      },
      get raw() {
        return res;
      },
      get headersSent() {
        return isSent;
      },
    };
  }

  public listen(port: number, callback?: () => void): http.Server {
    return this.server.listen(port, callback);
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
