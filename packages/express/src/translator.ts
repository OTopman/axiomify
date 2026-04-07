import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';
import crypto from 'crypto';
import type { Request, Response } from 'express';

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

export function translateResponse(res: Response): AxiomifyResponse {
  return {
    status(code: number) {
      res.status(code);
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
    send<T>(data: T, message: string = 'Operation successful') {
      const isError = res.statusCode >= 400;

      const body = {
        status: isError ? 'failed' : 'success',
        message:
          isError && message === 'Operation successful'
            ? 'An error occurred'
            : message,
        data: data,
      };

      res.json(body);
    },
    sendRaw(payload: any, contentType = 'text/plain') {
      res.setHeader('Content-Type', contentType);
      res.send(payload);
    },
    error(err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Error';
      res.status(500).json({
        status: 'failed',
        message,
        data: null,
      });
    },
    get raw() {
      return res;
    },
  };
}
