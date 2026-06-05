import type { ServerResponse } from 'node:http';
import type { Axiomify } from '@axiomify/core';
import { sendJson } from '../server/http-server';
import { extractValidationErrors } from '../utils/validation-errors';
import { recordSessionError } from './recorder';

export interface RecordedError {
  id: string;
  name: string;
  message: string;
  stack: string;
  method: string;
  path: string;
  payload: any;
  timestamp: string;
}

export const recordedErrors: RecordedError[] = [];

export function sanitizePayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  try {
    const serialized = JSON.parse(JSON.stringify(payload));
    const mask = (obj: any) => {
      for (const key of Object.keys(obj)) {
        const upperKey = key.toUpperCase();
        if (
          [
            'SECRET',
            'PASSWORD',
            'TOKEN',
            'KEY',
            'AUTH',
            'PASS',
            'CREDENTIAL',
            'PWD',
          ].some((word) => upperKey.includes(word))
        ) {
          obj[key] = '••••••••';
        } else if (obj[key] && typeof obj[key] === 'object') {
          mask(obj[key]);
        }
      }
    };
    mask(serialized);
    return serialized;
  } catch {
    return '[Unserializable Payload]';
  }
}

export function instrumentErrorObservatory(app: Axiomify): void {
  try {
    app.addHook('onError', (err: any, req: any) => {
      const errName = err?.name || err?.constructor?.name || 'Error';
      const errMsg = err?.message || String(err);
      const errStack = err?.stack || '';
      const reqPath = req?.path || '/';
      const reqMethod = req?.method || 'GET';
      const requestId = req?.id || req?._requestId || '';

      const payload = {
        body: sanitizePayload(req.body),
        query: sanitizePayload(req.query),
        params: req.params,
        validationErrors:
          errName === 'ValidationError'
            ? extractValidationErrors(err, req)
            : undefined,
      };

      const entry = {
        id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: errName,
        message: errMsg,
        stack: errStack,
        method: reqMethod,
        path: reqPath,
        payload,
        timestamp: new Date().toISOString(),
      };

      recordedErrors.push(entry);

      if (recordedErrors.length > 200) {
        recordedErrors.shift();
      }

      // Also push to unified session recorder
      recordSessionError({
        requestId,
        name: errName,
        message: errMsg,
        stack: errStack,
        method: reqMethod,
        path: reqPath,
        timestamp: entry.timestamp,
      });
    });
  } catch {
    // Ignore
  }
}

export function handleGetErrors(_req: any, res: ServerResponse): void {
  const errorsToday = recordedErrors.length;

  const frequencyMap = new Map<string, number>();
  for (const err of recordedErrors) {
    frequencyMap.set(err.name, (frequencyMap.get(err.name) || 0) + 1);
  }

  let topError = 'None';
  let topErrorCount = 0;
  for (const [name, count] of frequencyMap.entries()) {
    if (count > topErrorCount) {
      topError = name;
      topErrorCount = count;
    }
  }

  sendJson(res, {
    errorsToday,
    topError,
    topErrorCount,
    errors: recordedErrors,
  });
}
