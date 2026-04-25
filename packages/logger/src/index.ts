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
  /**
   * Include request headers in the log entry.
   * Defaults to `false` — headers often contain auth tokens and cookies.
   * Enable only when you are confident your log pipeline is secure and
   * sensitive headers are masked via `sensitiveFields`.
   */
  includeHeaders?: boolean;
  /**
   * Include the response payload in the log entry.
   * Defaults to `false` — payloads can contain PII.
   */
  includePayload?: boolean;
}

type LogLevel = NonNullable<LoggerOptions['level']>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function fallbackMaskObject(
  input: unknown,
  sensitiveFields: Set<string>,
): Record<string, any> {
  if (Array.isArray(input)) {
    return input.map((item) => fallbackMaskObject(item, sensitiveFields));
  }

  if (!input || typeof input !== 'object') return {};

  return Object.entries(input).reduce<Record<string, any>>(
    (acc, [key, value]) => {
      const isSensitive = sensitiveFields.has(key.toLowerCase());
      if (isSensitive && typeof value === 'string') {
        const visibleEnd = value.slice(-2);
        acc[key] = `${'*'.repeat(Math.max(3, value.length - 2))}${visibleEnd}`;
        return acc;
      }
      acc[key] = fallbackMaskObject(value, sensitiveFields);
      return acc;
    },
    {},
  );
}

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
  const includePayload = options.includePayload ?? false;

  const isProd = process.env.NODE_ENV === 'production';

  const sensitiveFieldSet = new Set(
    sensitiveFields.map((field) => field.toLowerCase()),
  );

  const emit = (
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {},
  ) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[logLevel]) return;

    const timestamp = new Date().toISOString();
    const maskedMeta =
      typeof Maskify.autoMask === 'function'
        ? Maskify.autoMask(meta)
        : fallbackMaskObject(meta, sensitiveFieldSet);

    if (beautify) {
      const colorMap = {
        debug: pc.gray,
        info: pc.cyan,
        warn: pc.yellow,
        error: pc.red,
      } as const;
      const color = colorMap[level];
      const summary = `${pc.gray(timestamp)} ${color(
        level.toUpperCase(),
      )} ${pc.bold(message)}`;
      const details = Object.keys(maskedMeta).length
        ? `\n${pc.dim(JSON.stringify(maskedMeta, null, 2))}`
        : '';
      console.log(`${summary}${details}`);
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        message,
        ...maskedMeta,
      })}\n`,
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
        ? {
            name: err.name,
            message: err.message,
            ...(!isProd && { stack: err.stack }),
          }
        : { message: String(err) };

    emit('error', 'Request Failed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      durationMs: durationMs.toFixed(3),
      error: errorObj,
    });
  });
}
