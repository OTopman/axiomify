import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { Readable } from 'stream';

export function translateRequest(req: Request): AxiomifyRequest {
  const state: Record<string, any> = {};
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();

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
      return req.ip || req.socket.remoteAddress || '0.0.0.0';
    },
    get headers() {
      return req.headers as Record<string, string | string[] | undefined>;
    },
    get stream() {
      return req;
    },
    // engine can overwrite them with transformed Zod data.
    body: req.body,
    query: req.query,
    params: req.params,

    get state() {
      return state;
    },
    get raw() {
      return req;
    },
  };
}

export function translateResponse(
  res: Response,
  serializer: any,
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
    removeHeader(key: string) {
      res.removeHeader(key);
      return this;
    },
    send<T>(data: T, message?: string) {
      isSent = true;
      const isError = statusCode >= 400;
      // Safely call the Serializer injected from the core app
      const payload = serializer(data, message, statusCode, isError);
      res.status(statusCode).json(payload);
    },
    sendRaw(payload: any, contentType = 'text/plain') {
      isSent = true;
      res.setHeader('Content-Type', contentType);
      res.status(statusCode).send(payload);
    },
    error(err: unknown) {
      isSent = true;
      const message = err instanceof Error ? err.message : 'Unknown Error';
      const payload = serializer(null, message, 500, true);
      res.status(500).json(payload);
    },

    // Streaming support (pipes a readable stream to the response)
    stream(readable: Readable, contentType = 'application/octet-stream') {
      isSent = true;
      res.setHeader('Content-Type', contentType);
      res.status(statusCode);
      readable.pipe(res);
    },

    // SSE (Server-Sent Events) setup
    sseInit() {
      isSent = true; // Mark headers as sent so core doesn't timeout/override
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    },

    // SSE payload dispatcher
    sseSend(data: any, event?: string) {
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // Optional: Call res.flush() here if using a compression middleware that requires it
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
