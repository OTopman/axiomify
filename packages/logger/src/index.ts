import { Axiomify } from '@axiomify/core';
import { Maskify } from 'maskify-ts';
import 'reflect-metadata';
import pc from 'picocolors';

export interface LoggerOptions {
  sensitiveFields?: string[];
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  beautify?: boolean;
  /** Include request headers in the log entry. */
  includeHeaders?: boolean;
  /** Include request route parameters (req.params) in the log entry. */
  includeParams?: boolean;
  /** Include request query parameters (req.query) in the log entry. */
  includeQuery?: boolean;
  /** Include request body (req.body) in the log entry. */
  includeBody?: boolean;
  /** Include response headers in the log entry. */
  includeResponseHeaders?: boolean;
  /** Include response payload/data in the log entry. */
  includeResponsePayload?: boolean;
  /** Alias for includeResponsePayload. */
  includePayload?: boolean;
  /** Include request state (req.state) in the log entry. */
  includeState?: boolean;
}

type LogLevel = NonNullable<LoggerOptions['level']>;

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export function useLogger(app: Axiomify, options: LoggerOptions = {}): void {
  const sensitiveFields = options.sensitiveFields ?? [
    'password',
    'token',
    'authorization',
    'credit_card',
    'ssn',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
  ];
  const logLevel = options.level ?? 'info';
  const beautify = options.beautify ?? process.stdout.isTTY ?? true;

  // Safe defaults: opt-in to verbose logging, not opt-out.
  const includeHeaders = options.includeHeaders ?? false;
  const includeParams = options.includeParams ?? false;
  const includeQuery = options.includeQuery ?? false;
  const includeBody = options.includeBody ?? false;
  const includeResponseHeaders = options.includeResponseHeaders ?? false;
  const includeResponsePayload =
    options.includeResponsePayload ?? options.includePayload ?? false;
  const includeState = options.includeState ?? false;

  const isProd = process.env.NODE_ENV === 'production';

  const emit = (
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {},
  ) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[logLevel]) return;

    const timestamp = new Date().toISOString();
    const maskedMeta = Maskify.autoMask(meta, {
      sensitiveKeys: sensitiveFields,
    });

    if (beautify) {
      const colorMap = {
        trace: pc.gray,
        debug: pc.gray,
        info: pc.cyan,
        warn: pc.yellow,
        error: pc.red,
        fatal: (str: string) => pc.bold(pc.red(str)),
      } as const;
      const color = colorMap[level];
      const summary = `${pc.gray(timestamp)} ${color(
        level.toUpperCase(),
      )} ${pc.bold(message)}`;
      const details = Object.keys(maskedMeta).length
        ? `\n${pc.dim(JSON.stringify(maskedMeta, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))}`
        : '';
      console.log(`${summary}${details}`);
      return;
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          timestamp,
          level: level.toUpperCase(),
          message,
          ...maskedMeta,
        },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      )}\n`,
    );
  };

  app.addHook('onRequest', (req) => {
    if (req.state.startTime === undefined) {
      req.state.startTime = process.hrtime.bigint();
    }

    emit('info', 'Incoming Request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
      ...(includeHeaders ? { headers: req.headers } : {}),
      ...(includeParams ? { params: req.params } : {}),
      ...(includeQuery ? { query: req.query } : {}),
      ...(includeBody ? { body: req.body } : {}),
      ...(includeState ? { state: req.state } : {}),
    });
  });

  app.addHook('onPostHandler', (req, res) => {
    const endTime = process.hrtime.bigint();
    const durationMs = req.state.startTime
      ? Number(endTime - req.state.startTime) / 1_000_000
      : 0;

    const resHeaders = (res as any)._headers || (res as any).headers || {};

    emit('info', 'Outgoing Response', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      statusCode: res.statusCode,
      ...(includeHeaders ? { headers: req.headers } : {}),
      ...(includeParams ? { params: req.params } : {}),
      ...(includeQuery ? { query: req.query } : {}),
      ...(includeBody ? { body: req.body } : {}),
      ...(includeResponseHeaders ? { responseHeaders: resHeaders } : {}),
      ...(includeResponsePayload ? { payload: (res as any).payload } : {}),
      ...(includeState ? { state: req.state } : {}),
    });
  });

  app.addHook('onError', (err: any, req, res) => {
    const endTime = process.hrtime.bigint();
    const durationMs = req.state.startTime
      ? Number(endTime - req.state.startTime) / 1_000_000
      : 0;

    const errorObj =
      err instanceof Error
        ? {
            name: err.name,
            message: err.message,
            ...(!isProd && { stack: err.stack }),
          }
        : { message: String(err) };

    const resHeaders = res
      ? (res as any)._headers || (res as any).headers || {}
      : {};

    emit('error', 'Request Failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      ...(res ? { statusCode: res.statusCode } : {}),
      error: errorObj,
      ...(includeHeaders ? { headers: req.headers } : {}),
      ...(includeParams ? { params: req.params } : {}),
      ...(includeQuery ? { query: req.query } : {}),
      ...(includeBody ? { body: req.body } : {}),
      ...(res && includeResponseHeaders ? { responseHeaders: resHeaders } : {}),
      ...(res && includeResponsePayload
        ? { payload: (res as any).payload }
        : {}),
      ...(includeState ? { state: req.state } : {}),
    });
  });
}
