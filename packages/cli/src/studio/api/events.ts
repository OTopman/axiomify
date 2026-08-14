import type { ServerResponse } from 'node:http';
import { logCorrelationStorage } from './logs';
import { getSessionData, recordEvent } from './recorder';
import { sendJson } from '../server/http-server';

const instrumentedEmitters = new WeakSet<object>();

function tokenLabel(token: unknown): string {
  return typeof token === 'symbol'
    ? token.description || token.toString()
    : String(token);
}

/**
 * Observe EventEmitter-like services without changing their event semantics.
 * Only configured application services are wrapped; Studio's own emitters are
 * deliberately excluded.
 */
export function instrumentEventRecording(app: unknown): void {
  const services = (app as { _services?: unknown })._services;
  if (!(services instanceof Map)) return;

  for (const [token, service] of services.entries()) {
    if (
      !service ||
      (typeof service !== 'object' && typeof service !== 'function')
    )
      continue;
    const emitter = service as { emit?: (...args: unknown[]) => unknown };
    if (typeof emitter.emit !== 'function' || instrumentedEmitters.has(emitter))
      continue;

    const originalEmit = emitter.emit;
    const label = tokenLabel(token);
    emitter.emit = function (event: unknown, ...args: unknown[]) {
      recordEvent({
        requestId: logCorrelationStorage.getStore(),
        type: `${label}:${String(event)}`,
        payload: args.length <= 1 ? args[0] : args,
        timestamp: new Date().toISOString(),
      });
      return originalEmit.call(this, event, ...args);
    };
    instrumentedEmitters.add(emitter);
  }
}

export function handleGetEvents(_req: unknown, res: ServerResponse): void {
  sendJson(res, { events: getSessionData().events.slice().reverse() });
}
