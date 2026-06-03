import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

export interface RecordedLog {
  id: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  stack?: string;
  timestamp: string;
}

export const recordedLogs: RecordedLog[] = [];

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

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'> = [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'trace',
  ];

  methods.forEach((method) => {
    console[method] = function(...args: any[]) {
      // 1. Invoke the original console function
      originalConsole[method].apply(console, args);

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

      // Avoid capturing the Studio's internal console logs or reload messages
      if (
        message.includes('Studio Live Sync') ||
        message.includes('🎨 Axiomify Studio') ||
        message.includes('Studio is live at') ||
        message.includes('Axiomify Dev Engine')
      ) {
        return;
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
        .filter((line) => !line.includes('node:internal') && !line.includes('console.ts'))
        .join('\n');

      recordedLogs.push({
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        level,
        message,
        stack: cleanedStack,
        timestamp: new Date().toISOString(),
      });

      if (recordedLogs.length > 500) {
        recordedLogs.shift();
      }

      notifyLogsUpdated();
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
