import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

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
        if (['SECRET', 'PASSWORD', 'TOKEN', 'KEY', 'AUTH', 'PASS', 'CREDENTIAL', 'PWD'].some(word => upperKey.includes(word))) {
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

function formatValidationErrors(err: any, req: any): any[] {
  const list: any[] = [];
  if (err && err.errors) {
    for (const [location, fieldErrors] of Object.entries(err.errors)) {
      if (fieldErrors && typeof fieldErrors === 'object') {
        for (const [field, reason] of Object.entries(fieldErrors as any)) {
          let received: any = undefined;
          const reqSource = (req as any)[location];
          if (reqSource && typeof reqSource === 'object') {
            const parts = field.split('.');
            let current = reqSource;
            for (const p of parts) {
              current = (current as any)?.[p];
            }
            received = current;
          }
          list.push({
            location,
            field,
            reason: String(reason),
            received,
          });
        }
      }
    }
  }
  return list;
}

export function instrumentErrorObservatory(app: any): void {
  try {
    app.addHook('onError', (err: any, req: any) => {
      const errName = err?.name || err?.constructor?.name || 'Error';
      const errMsg = err?.message || String(err);
      const errStack = err?.stack || '';
      
      const payload = {
        body: sanitizePayload(req.body),
        query: sanitizePayload(req.query),
        params: req.params,
        validationErrors: errName === 'ValidationError' ? formatValidationErrors(err, req) : undefined,
      };

      recordedErrors.push({
        id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: errName,
        message: errMsg,
        stack: errStack,
        method: req.method || 'GET',
        path: req.path || '/',
        payload,
        timestamp: new Date().toISOString(),
      });
      
      if (recordedErrors.length > 200) {
        recordedErrors.shift();
      }
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
