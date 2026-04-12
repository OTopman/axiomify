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

export class HttpAdapter {
  private server: http.Server;

  constructor(
    private core: Axiomify,
    options: { bodyLimitBytes?: number } = {},
  ) {
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
        console.error('[Axiomify Native HTTP Error]:', err);
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

  private async parseBody(
    req: IncomingMessage,
    limitBytes = 1_048_576,
  ): Promise<unknown> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;

    return new Promise((resolve, reject) => {
      let body = '';
      let receivedBytes = 0;
      let settled = false; // 🚀 State lock

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
        body += chunk.toString();
      });

      req.on('end', () => {
        if (settled) return;
        settled = true;
        if (!body) return resolve(undefined);
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
        return req.socket.remoteAddress || '0.0.0.0';
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
        isSent = true;
        res.setHeader('Content-Type', contentType);
        res.writeHead(statusCode);
        res.end(payload);
      },
      error(err: unknown) {
        isSent = true;
        const message = err instanceof Error ? err.message : 'Unknown Error';
        const payload = serializer(null, message, 500, true, req);

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify(payload));
      },

      // Native HTTP Stream implementation
      stream(readable: Readable, contentType = 'application/octet-stream') {
        isSent = true;
        res.setHeader('Content-Type', contentType);
        res.writeHead(statusCode);
        readable.pipe(res);
      },

      // Native HTTP SSE Init
      sseInit(sseHeartbeatMs: number = 15_000) {
        isSent = true;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const heartbeat = setInterval(() => {
          res.write(': keepalive\n\n');
        }, sseHeartbeatMs);
        res.on('close', () => clearInterval(heartbeat));
      },

      // Native HTTP SSE Send
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
