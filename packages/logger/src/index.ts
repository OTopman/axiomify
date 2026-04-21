import { Axiomify } from '@axiomify/core';
import { Maskify } from 'maskify-ts';
import pc from 'picocolors';

declare module '@axiomify/core' {
  interface RequestState {
    startTime?: bigint;
  }
}

export interface LoggerOptions {
  /** Fields to mask in logs. Default: common sensitive fields */
  sensitiveFields?: string[];
  /** Log level. Default: 'info' */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Whether to beautify console output. Default: true (if TTY) */
  beautify?: boolean;
}

export function useLogger(app: Axiomify, options: LoggerOptions = {}) {
  const sensitiveFields = options.sensitiveFields || [
    'password',
    'token',
    'authorization',
    'credit_card',
    'ssn',
    'cookie',
    'set-cookie'
  ];
  const logLevel = options.level || 'info';
  const beautify = options.beautify ?? process.stdout.isTTY ?? true;
  
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const currentLevelInt = levels[logLevel];

  const maskify = new Maskify({
    sensitiveKeys: sensitiveFields,
    maskChar: '*',
    visibleStart: 0,
    visibleEnd: 2,
  });

  const log = (
    level: keyof typeof levels,
    message: string,
    meta: Record<string, any>,
  ) => {
    if (levels[level] < currentLevelInt) return;

    const timestamp = new Date().toISOString();
    const maskedMeta = maskify.mask(meta);

    if (beautify) {
      const levelColors = {
        debug: pc.gray,
        info: pc.blue,
        warn: pc.yellow,
        error: pc.red,
      };
      const color = levelColors[level];
      
      console.log(
        `${pc.gray(`[${timestamp}]`)} ${color(level.toUpperCase().padEnd(5))} ${pc.bold(message)}`,
        Object.keys(maskedMeta).length > 0 ? pc.cyan(JSON.stringify(maskedMeta, null, 2)) : ''
      );
    } else {
      process.stdout.write(
        JSON.stringify({
          timestamp,
          level: level.toUpperCase(),
          message,
          ...maskedMeta,
        }) + '\n',
      );
    }
  };

  app.addHook('onRequest', (req, res) => {
    req.state.startTime = process.hrtime.bigint();
    log('info', `Incoming ${req.method} ${req.path}`, {
      requestId: req.id,
      ip: req.ip,
      headers: req.headers,
    });
  });

  app.addHook('onPostHandler', (req, res) => {
    const endTime = process.hrtime.bigint();
    const durationMs = req.state.startTime
      ? Number(endTime - req.state.startTime) / 1_000_000
      : 0;

    const status = res.status();
    const statusColor = status >= 500 ? pc.red : status >= 400 ? pc.yellow : pc.green;

    log('info', `Outgoing Response ${statusColor(status)}`, {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      payload: (res as any).payload,
    });
  });

  app.addHook('onError', (err: any, req) => {
    const endTime = process.hrtime.bigint();
    const durationMs = req.state.startTime
      ? Number(endTime - req.state.startTime) / 1_000_000
      : 0;
      
    const errorObj =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { err };

    log('error', `Request Failed: ${errorObj.message}`, {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      error: errorObj,
    });
  });
}
