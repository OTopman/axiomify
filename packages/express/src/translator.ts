import type { AxiomifyRequest, AxiomifyResponse, SerializerFn } from '@axiomify/core';
import crypto from 'crypto';
import type { Request, Response } from 'express';
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
    body: sanitize(req.body),
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
  serializer: SerializerFn,
  req: AxiomifyRequest
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
      const payload = serializer(data, message, statusCode, isError, req);
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
      const payload = serializer(null, message, 500, true, req);
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
    sseInit(sseHeartbeatMs: number = 15_000) {
      isSent = true;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const heartbeat = setInterval(() => {
        res.write(': keepalive\n\n');
      }, sseHeartbeatMs);
      res.on('close', () => clearInterval(heartbeat));
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
