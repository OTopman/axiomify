import type {
  AxiomifyRequest,
  AxiomifyResponse,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { sanitizeInput } from '@axiomify/core';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { Readable } from 'stream';

function createRequestSignal(req: Request): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('Client aborted request'));
    }
  };
  if (typeof req.once === 'function') {
    req.once('aborted', abort);
    req.once('close', () => {
      if (req.destroyed) abort();
    });
  }
  return controller.signal;
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

export function translateRequest(req: Request): AxiomifyRequest {
  const state: Record<string, unknown> = {};
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const signal = createRequestSignal(req);

  return {
    get id() {
      return id;
    },
    get method() {
      return req.method as AxiomifyRequest['method'];
    },
    get url() {
      return req.url;
    },
    get path() {
      return req.path;
    },
    get ip() {
      // req.ip returns the real client IP when Express trust proxy is configured
      // (set in ExpressAdapter constructor).  Fall back through the chain so
      // tests that don't go through the full adapter still get a value.
      return req.ip ?? req.socket.remoteAddress ?? '0.0.0.0';
    },
    get headers() {
      return req.headers as Record<string, string | string[] | undefined>;
    },
    get stream() {
      return req as unknown as Readable;
    },
    body: sanitizeInput(req.body),
    query: req.query,
    params: req.params,

    get state() {
      return state;
    },
    get raw() {
      return req;
    },
    get signal() {
      return signal;
    },
  };
}

export function translateResponse(
  res: Response,
  serializer: SerializerFn = (input: SerializerInput) => input.data,
  req?: AxiomifyRequest,
): AxiomifyResponse {
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
    getHeader(key: string) {
      const value = res.getHeader(key);
      return typeof value === 'string' ? value : undefined;
    },
    removeHeader(key: string) {
      res.removeHeader(key);
      return this;
    },

    send<T>(data: T, message?: string) {
      if (isSent) return;
      isSent = true;
      const isError = statusCode >= 400;
      const payload = serialize(serializer, {
        data,
        message,
        statusCode,
        isError,
        req,
      });
      res.status(statusCode).json(payload);
    },

    sendRaw(payload: unknown, contentType = 'text/plain') {
      if (isSent) return;
      isSent = true;
      res.setHeader('Content-Type', contentType);
      res.status(statusCode).send(payload);
    },

    error(err: unknown) {
      if (isSent) return;
      isSent = true;
      const message = err instanceof Error ? err.message : 'Unknown Error';
      const payload = serialize(serializer, {
        data: null,
        message,
        statusCode: 500,
        isError: true,
        req,
      });
      res.status(500).json(payload);
    },

    stream(readable: Readable, contentType = 'application/octet-stream') {
      if (isSent) return;
      isSent = true;
      res.setHeader('Content-Type', contentType);
      res.status(statusCode);
      readable.pipe(res);
    },

    sseInit(sseHeartbeatMs = 15_000) {
      if (isSent) return;
      isSent = true;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const heartbeat = setInterval(() => {
        res.write(': keepalive\n\n');
      }, sseHeartbeatMs);
      heartbeat.unref();
      res.on('close', () => clearInterval(heartbeat));
    },

    sseSend(data: unknown, event?: string) {
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
