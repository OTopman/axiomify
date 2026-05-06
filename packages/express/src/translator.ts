import type {
  AxiomifyRequest,
  AxiomifyResponse,
  HttpMethod,
  ResponseCapabilities,
  SerializerFn,
  SerializerInput,
} from '@axiomify/core';
import { makeSerialize, sanitizeInput } from '@axiomify/core';
import type { Request, Response } from 'express';
import { Readable } from 'stream';

const EXPRESS_CAPABILITIES: ResponseCapabilities = {
  sse: true,
  streaming: true,
};

// Per-process counter — avoids crypto.randomUUID() (~0.137µs) on every request.
let _expressCounter = 0;
const _expressPid = process.pid.toString(36);

/**
 * Translate an Express Request into an AxiomifyRequest.
 *
 * LAZY PROPERTIES — only materialised on first access:
 *   signal  — AbortController skipped entirely for handlers that don't
 *              perform cancellable async work (the common case).
 *
 * sanitize now defaults to false. See HttpAdapterOptions.sanitize for rationale.
 */
export function translateRequest(
  req: Request,
  sanitize = false,
): AxiomifyRequest {
  const body = sanitize ? sanitizeInput(req.body) : req.body;

  // Lazy AbortController — allocated only when `signal` is first accessed.
  let _controller: AbortController | undefined;
  let _aborted = false;

  const onAbort = () => {
    _aborted = true;
    _controller?.abort(new Error('Client aborted request'));
  };
  if (typeof req.once === 'function') {
    req.once('aborted', onAbort);
    req.once('close', () => { if (req.destroyed) onAbort(); });
  }

  // Lazy ID — avoids randomUUID() for handlers that never read req.id.
  let _id: string | undefined;

  return {
    get id(): string {
      if (!_id) {
        _id = (req.headers['x-request-id'] as string | undefined)
          ?? `${_expressPid}-${(++_expressCounter).toString(36)}`;
      }
      return _id;
    },

    method: req.method as HttpMethod,
    url: req.url,
    path: req.path,
    ip: req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0',
    headers: req.headers as Record<string, string | string[] | undefined>,
    stream: req as unknown as Readable,
    body,
    query: req.query as Record<string, string | string[]>,
    params: req.params,
    state: {},
    raw: req,

    get signal(): AbortSignal {
      if (!_controller) {
        _controller = new AbortController();
        if (_aborted) _controller.abort(new Error('Client aborted request'));
      }
      return _controller.signal;
    },
  };
}

export function translateResponse(
  res: Response,
  serializer: SerializerFn = (input: SerializerInput) => input.data,
  req?: AxiomifyRequest,
): AxiomifyResponse {
  // makeSerialize imported from @axiomify/core — single source of truth.
  // Arity normalised once per response, never per send() call.
  const serialize = makeSerialize(serializer);
  // Pre-allocate the input bag — mutated in place on every send() call
  // instead of creating a new object each time.
  const _input: SerializerInput = {
    data: undefined,
    message: undefined,
    statusCode: 200,
    isError: false,
    req,
  };
  let statusCode = 200;
  let isSent = false;

  return {
    capabilities: EXPRESS_CAPABILITIES,

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
      _input.data = data;
      _input.message = message;
      _input.statusCode = statusCode;
      _input.isError = statusCode >= 400;
      const payload = serialize(_input);
      res.status(statusCode).json(payload);
    },

    sendRaw(payload: unknown, contentType = 'text/plain') {
      if (isSent) return;
      isSent = true;
      res.setHeader('Content-Type', contentType);
      res.status(statusCode).send(payload);
    },

    /** @deprecated Use res.status(code).send(null, message) instead. */
    error(err: unknown) {
      if (isSent) return;
      isSent = true;
      const message = err instanceof Error ? err.message : 'Unknown Error';
      const errCode = (err as Record<string, unknown>).statusCode as number ?? 500;
      _input.data = null;
      _input.message = message;
      _input.statusCode = errCode;
      _input.isError = true;
      res.status(errCode).json(serialize(_input));
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
      const heartbeat = setInterval(() => { res.write(': keepalive\n\n'); }, sseHeartbeatMs);
      heartbeat.unref();
      res.on('close', () => clearInterval(heartbeat));
    },

    sseSend(data: unknown, event?: string) {
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },

    get statusCode() { return statusCode; },
    get raw() { return res; },
    get headersSent() { return isSent; },
  };
}
