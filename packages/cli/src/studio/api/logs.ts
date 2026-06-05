import type { ServerResponse } from 'node:http';
import * as path from 'node:path';
import { sendJson } from '../server/http-server';
import { AsyncLocalStorage } from 'node:async_hooks';

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

let onLogsUpdatedCallback: (() => void) | null = null;

export function setOnLogsUpdated(cb: () => void): void {
  onLogsUpdatedCallback = cb;
}

export function notifyLogsUpdated(): void {
  if (onLogsUpdatedCallback) {
    onLogsUpdatedCallback();
  }
}

export function instrumentLogs(): void {
  if (isInstrumented) return;
  isInstrumented = true;

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'> =
    ['log', 'info', 'warn', 'error', 'debug', 'trace'];

  let inHook = false;

  methods.forEach((method) => {
    console[method] = function (...args: any[]) {
      // 1. Invoke the original console function
      originalConsole[method].apply(console, args);

      if (inHook) return;
      inHook = true;

      try {
        // 2. Format the message payload safely
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

        // Map method to a normalized log level
        let level: RecordedLog['level'] = 'info';
        if (method === 'warn') level = 'warn';
        else if (method === 'error') level = 'error';
        else if (method === 'debug') level = 'debug';
        else if (method === 'trace') level = 'trace';

        // 3. Extract call stack trace
        const err = new Error();
        const rawStack = err.stack || '';
        const lines = rawStack.split('\n');

        // Filter out internal wrapper/console interception stack frames
        const cleanedStack = lines
          .slice(2)
          .filter(
            (line) =>
              !line.includes('node:internal') && !line.includes('console.ts'),
          )
          .join('\n');

        // Determine if log is internal to Axiomify framework or Studio
        let isInternal = false;
        if (
          message.includes('Studio Live Sync') ||
          message.includes('🎨 Axiomify Studio') ||
          message.includes('Studio is live at') ||
          message.includes('Axiomify Dev Engine') ||
          message.startsWith('[axiomify/') ||
          message.includes('[Axiomify]') ||
          rawStack.includes('packages/cli/src/studio/')
        ) {
          isInternal = true;
        }

        // Parse source file and line from stack
        let source = 'unknown';
        const stackLines = cleanedStack.split('\n');
        for (const line of stackLines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Matches typical "at functionName (/path/to/file.ts:12:34)" or "at /path/to/file.ts:12:34"
          const match = /(?:\(|at\s+)([^\s()]+?):(\d+)(?::(\d+))?\)?$/.exec(trimmed);
          if (match) {
            const filePath = match[1];
            if (filePath.includes('node:internal') || filePath.includes('node_modules')) {
              continue;
            }
            const relativePath = path.isAbsolute(filePath)
              ? path.relative(process.cwd(), filePath)
              : filePath;
            source = `${relativePath}:${match[2]}`;
            break;
          }
        }

        const requestId = logCorrelationStorage.getStore();

        recordedLogs.push({
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          level,
          message,
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
      } catch (e) {
        // ignore errors during logging
      } finally {
        inHook = false;
      }
    };
  });
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
