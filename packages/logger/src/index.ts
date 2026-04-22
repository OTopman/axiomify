import { Axiomify } from '@axiomify/core';
import { Maskify } from 'maskify-ts';
import pc from 'picocolors';

declare module '@axiomify/core' {
  interface RequestState {
    startTime?: bigint;
  }
}

export interface LoggerOptions {
  sensitiveFields?: string[];
  level?: 'debug' | 'info' | 'warn' | 'error';
  beautify?: boolean;
  includeHeaders?: boolean;
  includePayload?: boolean;
}

type LogLevel = NonNullable<LoggerOptions['level']>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function useLogger(app: Axiomify, options: LoggerOptions = {}): void {
  const sensitiveFields = options.sensitiveFields || [
    'password',
    'token',
    'authorization',
    'credit_card',
    'ssn',
    'cookie',
    'set-cookie',
  ];
  const logLevel = options.level ?? 'info';
  const beautify = options.beautify ?? process.stdout.isTTY ?? true;
  const includeHeaders = options.includeHeaders ?? true;
  const includePayload = options.includePayload ?? true;

  const maskify = new Maskify({
    sensitiveKeys: sensitiveFields,
    maskChar: '*',
    visibleStart: 1,
    visibleEnd: 2,
  });

  const emit = (level: LogLevel, message: string, meta: Record<string, any> = {}) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[logLevel]) return;

    const timestamp = new Date().toISOString();
    const maskedMeta = maskify.mask(meta);

    if (beautify) {
      const colorMap = {
        debug: pc.gray,
        info: pc.cyan,
        warn: pc.yellow,
        error: pc.red,
      } as const;
      const color = colorMap[level];
      const summary = `${pc.gray(timestamp)} ${color(level.toUpperCase())} ${pc.bold(message)}`;
      const details = Object.keys(maskedMeta).length
        ? `\n${pc.dim(JSON.stringify(maskedMeta, null, 2))}`
        : '';
      console.log(`${summary}${details}`);
      return;
    }

    process.stdout.write(
      `${JSON.stringify({ timestamp, level: level.toUpperCase(), message, ...maskedMeta })}\n`,
    );
  };

  app.addHook('onRequest', (req) => {
    req.state.startTime = process.hrtime.bigint();

    emit('info', 'Incoming Request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
      ...(includeHeaders ? { headers: req.headers } : {}),
    });
  });

  app.addHook('onPostHandler', (req, res) => {
    const endTime = process.hrtime.bigint();
    const durationMs = req.state.startTime
      ? Number(endTime - req.state.startTime) / 1_000_000
      : 0;

    emit('info', 'Outgoing Response', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      statusCode: res.statusCode,
      ...(includePayload ? { payload: (res as any).payload } : {}),
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
        : { message: String(err), value: err };

    emit('error', 'Request Failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      error: errorObj,
    });
  });
}
