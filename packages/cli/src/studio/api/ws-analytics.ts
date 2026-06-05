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
let isWsAnalyticsInstrumented = false;
let metricsInterval: NodeJS.Timeout | null = null;

function startWsMetricsInterval(): void {
  if (metricsInterval) return;
  metricsInterval = setInterval(() => {
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
  metricsInterval.unref?.();
}

export function stopWsMetricsInterval(): void {
  if (!metricsInterval) return;
  clearInterval(metricsInterval);
  metricsInterval = null;
}

export const roomManagers: any[] = [];

export function instrumentWsAnalytics(): void {
  if (isWsAnalyticsInstrumented) return;

  try {
    const wsPath = require.resolve('@axiomify/ws', { paths: [process.cwd()] });
    if (!wsPath) return;

    const wsPkg = require(wsPath);
    if (!wsPkg?.RoomManager) return;

    // Proxy the RoomManager constructor to collect instances
    const originalRoomManager = wsPkg.RoomManager;
    const roomManagerProxy = function (this: any, ...args: any[]) {
      const instance = Reflect.construct(originalRoomManager, args, (new.target || originalRoomManager) as any);
      roomManagers.push(instance);
      return instance;
    };
    roomManagerProxy.prototype = originalRoomManager.prototype;
    Object.setPrototypeOf(roomManagerProxy, originalRoomManager);
    wsPkg.RoomManager = roomManagerProxy as any;

    const originalEmit = wsPkg.RoomManager.prototype.emit;
    wsPkg.RoomManager.prototype.emit = function (
      event: string,
      ...args: any[]
    ) {
      wsMetrics.messagesReceived++;
      wsMetrics.eventsCount[event] =
        (wsMetrics.eventsCount[event] || 0) + 1;

      try {
        const payloadStr = JSON.stringify(args);
        const size = Buffer.byteLength(payloadStr, 'utf8');
        wsMetrics.totalPayloadSize += size;
        if (size > wsMetrics.largestPayloadSize) {
          wsMetrics.largestPayloadSize = size;
        }
      } catch { }

      const start = performance.now();
      try {
        const ret = originalEmit.apply(this, arguments as any);
        const duration = performance.now() - start;
        if (
          !wsMetrics.slowestHandler ||
          duration > wsMetrics.slowestHandler.duration
        ) {
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

    isWsAnalyticsInstrumented = true;
    startWsMetricsInterval();
  } catch {
    // Ignore
  }
}

export function handleGetWsAnalytics(_req: any, res: ServerResponse): void {
  let activeConnections = 0;
  let totalRooms = 0;
  const clients: any[] = [];
  const rooms: Record<string, number> = {};

  roomManagers.forEach((manager) => {
    activeConnections += manager.clientCount;
    totalRooms += manager.roomCount;
    manager.clientIds.forEach((id: string) => {
      const c = manager.client(id);
      if (c) {
        clients.push({
          id: c.id,
          protocol: 'uWS',
        });
      }
    });
    const stats = manager.getStats();
    Object.entries(stats.rooms).forEach(([name, size]) => {
      rooms[name] = (rooms[name] || 0) + (size as number);
    });
  });

  sendJson(res, {
    activeConnections,
    totalRooms,
    totalFramesReceived: wsMetrics.messagesReceived,
    totalFramesSent: wsMetrics.messagesSent,
    clients,
    rooms,
    metrics: wsMetrics,
    rates: messageRates,
  });
}
