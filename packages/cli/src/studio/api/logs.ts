import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerResponse } from 'node:http';
import * as path from 'node:path';
import { sendJson } from '../server/http-server';

export interface RecordedLog {
  id: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  stack?: string;
  timestamp: string;
  source?: string;
  isInternal?: boolean;
  requestId?: string;
}

export const recordedLogs: RecordedLog[] = [];
export const logCorrelationStorage = new AsyncLocalStorage<string>();

let isInstrumented = false;
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  trace: console.trace,
};
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

let onLogsUpdatedCallback: (() => void) | null = null;

export function setOnLogsUpdated(cb: () => void): void {
  onLogsUpdatedCallback = cb;
}

let debounceTimeout: NodeJS.Timeout | null = null;
export function notifyLogsUpdated(): void {
  if (onLogsUpdatedCallback && !debounceTimeout) {
    debounceTimeout = setTimeout(() => {
      debounceTimeout = null;
      onLogsUpdatedCallback?.();
    }, 100);
  }
}

let inConsoleCall = false;

function recordRawLog(level: RecordedLog['level'], message: string): void {
  try {
    const requestId = logCorrelationStorage.getStore();
    let isInternal = false;
    let source = 'app';
    let cleanedStack = '';

    const isStudioMockRequest =
      !!requestId &&
      (requestId.startsWith('studio-metrics-') ||
        requestId.startsWith('studio-ws-metrics-') ||
        requestId.startsWith('studio-contract-') ||
        requestId.startsWith('studio-security-'));

    const isAppRequest = !!requestId && !isStudioMockRequest;
    const shouldSkipStack =
      isAppRequest &&
      level !== 'error' &&
      level !== 'fatal' &&
      level !== 'warn';

    if (isStudioMockRequest) {
      isInternal = true;
      source = 'studio';
    } else if (shouldSkipStack) {
      isInternal = false;
      source = 'app';
    } else {
      const err = new Error();
      const rawStack = err.stack || '';
      const lines = rawStack.split('\n');
      const filteredLines = lines
        .slice(2)
        .filter(
          (line) =>
            !line.includes('node:internal') &&
            !line.includes('console.ts') &&
            !line.includes('logs.ts'),
        );

      // The full cleaned stack (for display)
      cleanedStack = filteredLines.join('\n');

      // For classification, skip the first frame which is always the
      // console.<computed> wrapper living in packages/cli/dist/index.js.
      // We need to look at the *real caller* frames to decide if the log
      // originates from studio code or app code.
      const callerLines = filteredLines.filter(
        (line) =>
          !line.includes('console.<computed>') &&
          !line.includes('console.value'),
      );
      const callerStack = callerLines.join('\n');

      // A log is "studio code" only if the CALLER frames (not the wrapper)
      // are exclusively from the CLI/Studio internals.
      const studioPatterns = [
        '/packages/cli/src/studio/',
        '/packages/cli/dist/',
        'node_modules/@axiomify/cli',
        '/@axiomify/cli/',
      ];

      // Check if the caller frames reference app-related code
      const appPatterns = [
        'inspect.cjs',
        '.axiomify/',
        'packages/core',
        'packages/logger',
        'packages/ws',
        'packages/auth',
        'packages/metrics',
        'packages/openapi',
        'packages/graphql',
        'packages/helmet',
        'packages/static',
        'packages/upload',
        'packages/native',
        'packages/session',
        'packages/cache',
        'packages/compress',
        'packages/db',
        'node_modules/@axiomify/core',
        'node_modules/@axiomify/logger',
        'node_modules/@axiomify/ws',
        'node_modules/@axiomify/auth',
        'node_modules/@axiomify/metrics',
        'node_modules/@axiomify/session',
        'node_modules/@axiomify/cache',
        'node_modules/@axiomify/compress',
        'node_modules/@axiomify/db',
      ];

      const hasAppFrame = appPatterns.some((p) => callerStack.includes(p));
      const hasRequestId = !!requestId;

      // Determine if the log is truly from studio internals
      // A log is internal ONLY if:
      // 1. ALL caller frames are from studio/cli code, AND
      // 2. There is no request correlation ID (which indicates app dispatch), AND
      // 3. No app-related frames are present
      const isOnlyStudioFrames =
        callerLines.length > 0 &&
        callerLines.every(
          (line) =>
            studioPatterns.some((p) => line.includes(p)) ||
            line.includes('node:') ||
            line.trim() === '',
        );

      if (
        (isOnlyStudioFrames && !hasAppFrame && !hasRequestId) ||
        isStudioMockRequest
      ) {
        isInternal = true;
      }

      source = 'unknown';
      // For source detection, skip frames from cli/dist to find the real caller
      const stackLines = callerLines.length > 0 ? callerLines : filteredLines;
      for (const line of stackLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = /(?:\(|at\s+)([^\s()]+?):(\d+)(?::(\d+))?\)?$/.exec(
          trimmed,
        );
        if (match) {
          const filePath = match[1];
          if (
            filePath.includes('node:internal') ||
            filePath.includes('node_modules')
          ) {
            continue;
          }
          // Skip frames from the CLI dist bundle for source attribution
          if (filePath.includes('packages/cli/dist/')) {
            continue;
          }
          const relativePath = path.isAbsolute(filePath)
            ? path.relative(process.cwd(), filePath)
            : filePath;
          source = `${relativePath}:${match[2]}`;
          break;
        }
      }
    }

    recordedLogs.push({
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      level,
      message: message.trim(),
      stack: cleanedStack,
      timestamp: new Date().toISOString(),
      source,
      isInternal,
      requestId,
    });

    if (recordedLogs.length > 500) {
      recordedLogs.shift();
    }

    notifyLogsUpdated();
  } catch {
    // Ignore internal log recording errors
  }
}

export function instrumentLogs(): void {
  if (isInstrumented) return;
  isInstrumented = true;

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'> =
    ['log', 'info', 'warn', 'error', 'debug', 'trace'];

  methods.forEach((method) => {
    console[method] = function (...args: any[]) {
      if (inConsoleCall) {
        originalConsole[method].apply(console, args);
        return;
      }
      inConsoleCall = true;
      try {
        originalConsole[method].apply(console, args);

        let message = '';
        try {
          message = args
            .map((arg) => {
              if (arg instanceof Error) {
                return arg.stack || arg.message;
              }
              if (typeof arg === 'object' && arg !== null) {
                try {
                  return JSON.stringify(arg);
                } catch {
                  return String(arg);
                }
              }
              return String(arg);
            })
            .join(' ');
        } catch {
          message = '[Unformattable Log Message]';
        }

        let level: RecordedLog['level'] = 'info';
        if (method === 'warn') level = 'warn';
        else if (method === 'error') level = 'error';
        else if (method === 'debug') level = 'debug';
        else if (method === 'trace') level = 'trace';

        recordRawLog(level, message);
      } finally {
        inConsoleCall = false;
      }
    };
  });

  // Intercept process.stdout.write
  process.stdout.write = function (
    chunk: any,
    encoding?: any,
    callback?: any,
  ): boolean {
    if (inConsoleCall) {
      return originalStdoutWrite.call(
        process.stdout,
        chunk,
        encoding,
        callback,
      );
    }
    inConsoleCall = true;
    try {
      const message =
        typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (message.trim()) {
        recordRawLog('info', message);
      }
    } catch {
      // Ignore
    } finally {
      inConsoleCall = false;
    }
    return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
  } as any;

  // Intercept process.stderr.write
  process.stderr.write = function (
    chunk: any,
    encoding?: any,
    callback?: any,
  ): boolean {
    if (inConsoleCall) {
      return originalStderrWrite.call(
        process.stderr,
        chunk,
        encoding,
        callback,
      );
    }
    inConsoleCall = true;
    try {
      const message =
        typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (message.trim()) {
        recordRawLog('error', message);
      }
    } catch {
      // Ignore
    } finally {
      inConsoleCall = false;
    }
    return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
  } as any;
}

export function handleGetLogs(_req: any, res: ServerResponse): void {
  sendJson(res, { logs: recordedLogs });
}

export function handleDeleteLogs(_req: any, res: ServerResponse): void {
  recordedLogs.length = 0;
  notifyLogsUpdated();
  sendJson(res, { success: true });
}

export function handleExportLogs(_req: any, res: ServerResponse): void {
  const data = JSON.stringify({ logs: recordedLogs }, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="axiomify-logs-${Date.now()}.json"`,
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}
