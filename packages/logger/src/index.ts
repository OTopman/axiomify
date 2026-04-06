import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import { Maskify } from 'maskify-ts';

export interface LoggerOptions {
  /** Fields to mask in the logs (e.g., ['password', 'token', 'credit_card']) */
  sensitiveFields?: string[];
  /** Minimum log level (e.g., 'info', 'warn', 'error') */
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export function useLogger(app: Axiomify, options: LoggerOptions = {}): void {
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

  // Helper for structured JSON output
  const log = (
    level: keyof typeof levels,
    message: string,
    meta: Record<string, any>,
  ) => {
    if (levels[level] < currentLevelInt) return;

    const output = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...Maskify.autoMask(meta, {
        sensitiveKeys: sensitiveFields,
        maskChar: '*',
        visibleStart: 0,
        visibleEnd: 2,
      }), // Automatically recursively masks the payload
    };

    // In production, write directly to stdout for log forwarders to pick up
    process.stdout.write(JSON.stringify(output) + '\n');
  };

  // 1. Log Incoming Requests
  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    req.state.startTime = process.hrtime.bigint();

    log('info', 'Incoming Request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
      // We mask headers and query/body (though body is usually unparsed here,
      // if a pre-parser exists, maskify handles it securely).
      headers: req.headers,
      query: req.query,
    });
  });

  // 2. Log Outgoing Responses
  app.addHook(
    'onPostHandler',
    (req: AxiomifyRequest, res: AxiomifyResponse) => {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - req.state.startTime) / 1_000_000;

      // We hook into the 'send' method dynamically to capture the final payload
      const originalSend = res.send.bind(res);
      res.send = <T>(data: T, message?: string) => {
        log('info', 'Outgoing Response', {
          requestId: req.id,
          method: req.method,
          path: req.path,
          durationMs: durationMs.toFixed(3),
          responseMessage: message,
          payload: data,
        });
        originalSend(data, message);
      };
    },
  );

  // 3. Centralized Error Logging
  app.addHook('onError', (err: any, req: AxiomifyRequest, res: AxiomifyResponse) => {
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
