import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

export interface WsMetrics {
  messagesReceived: number;
  messagesSent: number;
  totalPayloadSize: number;
  largestPayloadSize: number;
  eventsCount: Record<string, number>;
  slowestHandler: { event: string; duration: number } | null;
  failedEvents: Array<{ event: string; error: string; timestamp: string }>;
}

export const wsMetrics: WsMetrics = {
  messagesReceived: 0,
  messagesSent: 0,
  totalPayloadSize: 0,
  largestPayloadSize: 0,
  eventsCount: {},
  slowestHandler: null,
  failedEvents: [],
};

let lastReceived = 0;
export const messageRates: Array<{ timestamp: string; rate: number }> = [];

setInterval(() => {
  const current = wsMetrics.messagesReceived;
  const rate = current - lastReceived;
  lastReceived = current;
  
  messageRates.push({
    timestamp: new Date().toISOString(),
    rate,
  });
  if (messageRates.length > 60) {
    messageRates.shift();
  }
}, 1000);

export function instrumentWsAnalytics(): void {
  try {
    const wsPath = require.resolve('@axiomify/ws', { paths: [process.cwd()] });
    if (wsPath) {
      const wsPkg = require(wsPath);
      if (wsPkg && wsPkg.RoomManager) {
        const originalEmit = wsPkg.RoomManager.prototype.emit;
        wsPkg.RoomManager.prototype.emit = function(event: string, ...args: any[]) {
          wsMetrics.messagesReceived++;
          wsMetrics.eventsCount[event] = (wsMetrics.eventsCount[event] || 0) + 1;
          
          try {
            const payloadStr = JSON.stringify(args);
            const size = Buffer.byteLength(payloadStr, 'utf8');
            wsMetrics.totalPayloadSize += size;
            if (size > wsMetrics.largestPayloadSize) {
              wsMetrics.largestPayloadSize = size;
            }
          } catch {}

          const start = performance.now();
          try {
            const ret = originalEmit.apply(this, arguments);
            const duration = performance.now() - start;
            if (!wsMetrics.slowestHandler || duration > wsMetrics.slowestHandler.duration) {
              wsMetrics.slowestHandler = { event, duration };
            }
            return ret;
          } catch (err: any) {
            wsMetrics.failedEvents.push({
              event,
              error: err.message,
              timestamp: new Date().toISOString(),
            });
            if (wsMetrics.failedEvents.length > 50) {
              wsMetrics.failedEvents.shift();
            }
            throw err;
          }
        };
      }
    }
  } catch {
    // Ignore
  }
}

export function handleGetWsAnalytics(_req: any, res: ServerResponse): void {
  sendJson(res, {
    metrics: wsMetrics,
    rates: messageRates,
  });
}
