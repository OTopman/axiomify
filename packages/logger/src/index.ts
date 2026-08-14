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

/**
 * Value-shape patterns for obvious secret formats. This is a best-effort
 * secondary defense on top of the key-name deny-list masking: it catches
 * secrets that appear under unlisted keys (e.g. inside a logged request
 * body/query/state). It is NOT exhaustive and cannot catch every secret
 * shape; treat it as defense-in-depth, not a guarantee.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  // JWT: header.payload.signature (base64url segments, starts with eyJ)
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Bearer <token>
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Long hex blob (>= 32 hex chars, e.g. API keys / hashes)
  /\b[0-9a-fA-F]{32,}\b/g,
  // Long base64/base64url blob (>= 40 chars)
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
];

const SECRET_MASK = '••••••••';

/**
 * Recursively masks values whose string form matches an obvious secret shape.
 * Best-effort only: complements, and does not replace, key-name masking.
 */
function maskSecretShapes(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, SECRET_MASK);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskSecretShapes(v, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return value;
    seen.add(value as object);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = maskSecretShapes(v, seen);
    }
    return result;
  }
  return value;
}

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

  // Value-shape masking is only meaningful (and only worth its cost) when we
  // actually log potentially-secret-bearing values. Stays off-path by default.
  const valueMaskingEnabled =
    includeBody ||
    includeQuery ||
    includeState ||
    includeParams ||
    includeResponsePayload;

  const isProd = process.env.NODE_ENV === 'production';

  const emit = (
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {},
  ) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[logLevel]) return;

    const timestamp = new Date().toISOString();
    const keyMaskedMeta = Maskify.autoMask(meta, {
      sensitiveKeys: sensitiveFields,
    });
    // Best-effort value-shape masking layered on top of key-name masking, so
    // secrets under unlisted keys in logged body/query/state are still redacted.
    const maskedMeta = valueMaskingEnabled
      ? (maskSecretShapes(keyMaskedMeta) as Record<string, unknown>)
      : keyMaskedMeta;

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
