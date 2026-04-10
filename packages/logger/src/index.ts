import { Axiomify } from '@axiomify/core';
import { Maskify } from 'maskify-ts';

declare module '@axiomify/core' {
  interface RequestState {
    startTime?: bigint;
  }
}

export interface LoggerOptions {
  sensitiveFields?: string[];
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export function useLogger(app: Axiomify, options: LoggerOptions = {}) {
  const sensitiveFields = options.sensitiveFields || [
    'password',
    'token',
    'authorization',
    'credit_card',
    'ssn',
  ];
  const logLevel = options.level || 'info';
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const currentLevelInt = levels[logLevel];

  const log = (
    level: keyof typeof levels,
    message: string,
    meta: Record<string, any>,
  ) => {
    if (levels[level] < currentLevelInt) return;
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message,
        ...Maskify.autoMask(meta, {
          sensitiveKeys: sensitiveFields,
          maskChar: '*',
          visibleStart: 0,
          visibleEnd: 2,
        }),
      }) + '\n',
    );
  };

  app.addHook('onRequest', (req, res) => {
    req.state.startTime = process.hrtime.bigint();
    log('info', 'Incoming Request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
      headers: req.headers,
    });
  });

  app.addHook('onPreHandler', (req, res) => {
    const originalSend = res.send.bind(res);
    res.send = (data: any, message?: string) => {
      const endTime = process.hrtime.bigint();
      const durationMs = req.state.startTime
        ? Number(endTime - req.state.startTime) / 1_000_000
        : 0;
      log('info', 'Outgoing Response', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        durationMs: durationMs.toFixed(3),
        responseMessage: message,
        payload: data,
      });
      return originalSend(data, message);
    };
  });

  // 3. Log errors
  app.addHook('onError', (err: any, req) => {
    const endTime = process.hrtime.bigint();
    const durationMs = req.state.startTime
      ? Number(endTime - req.state.startTime) / 1_000_000
      : 0;
    const errorObj =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { err };
    log('error', 'Request Failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      error: errorObj,
    });
  });
}
