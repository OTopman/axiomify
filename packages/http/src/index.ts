import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import http from 'http';

export class HttpAdapter {
  private server: http.Server;

  constructor(private core: Axiomify) {
    this.server = http.createServer(async (req, res) => {
      try {
        const body = await this.parseBody(req);
        const axiomifyReq = this.translateRequest(req, body);
        const axiomifyRes = this.translateResponse(res);

        await this.core.handle(axiomifyReq, axiomifyRes);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            status: 'failed',
            message: 'Internal Server Error',
            data: null,
          }),
        );
      }
    });
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;

    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        if (!body) return resolve(undefined);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
      req.on('error', reject);
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
    };
  }

  private translateResponse(res: ServerResponse): AxiomifyResponse {
    return {
      status(code: number) {
        res.statusCode = code;
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
      send<T>(data: T, message = 'Operation successful') {
        if (!res.hasHeader('Content-Type'))
          res.setHeader('Content-Type', 'application/json');
        const isError = res.statusCode >= 400;
        res.end(
          JSON.stringify({
            status: isError ? 'failed' : 'success',
            message,
            data,
          }),
        );
      },
      sendRaw(payload: any, contentType = 'text/plain') {
        res.setHeader('Content-Type', contentType);
        res.end(payload);
      },
      error(err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown Error';
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'failed', message, data: null }));
      },
      get raw() {
        return res;
      },
    };
  }

  public listen(port: number, callback?: () => void): http.Server {
    return this.server.listen(port, callback);
  }
}
