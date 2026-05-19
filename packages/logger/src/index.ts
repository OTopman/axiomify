import { Axiomify } from '@axiomify/core';
// ─── Inline PII masker ────────────────────────────────────────────────────────
// Zero external dependencies. Walks objects/arrays recursively (depth-capped
// at 32) and replaces any key whose lowercase name contains a sensitive field
// name with '****'.

const MASK = '****';

function maskData(value: unknown, sensitiveKeys: string[], depth = 0): unknown {
  if (depth > 32) return value;
  if (Array.isArray(value))
    return value.map((item) => maskData(item, sensitiveKeys, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      out[k] = sensitiveKeys.some((f) => lower.includes(f.toLowerCase()))
        ? MASK
        : maskData(v, sensitiveKeys, depth + 1);
    }
    return out;
  }
  return value;
}

import pc from 'picocolors';

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

  const emit = (
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {},
  ) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[logLevel]) return;

    const timestamp = new Date().toISOString();
    const maskedMeta = maskData(meta, sensitiveFields) as Record<string, unknown>;

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
