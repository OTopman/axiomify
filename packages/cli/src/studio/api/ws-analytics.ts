import type { ServerResponse } from 'node:http';
import { RequestStateImpl } from '@axiomify/core';
import { sendJson } from '../server/http-server';
import { logCorrelationStorage } from './logs';

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

// ── Connection tracking ────────────────────────────────────────────────────
// Tracks individual live connections regardless of adapter
export const trackedSockets: Map<
  string,
  { id: string; protocol: string; connectedAt: string }
> = new Map();

let socketIdCounter = 0;
function nextSocketId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++socketIdCounter}`;
}

function trackConnect(id: string, protocol: string): void {
  trackedSockets.set(id, {
    id,
    protocol,
    connectedAt: new Date().toISOString(),
  });
}

function trackDisconnect(id: string): void {
  trackedSockets.delete(id);
}

// ── Message rate sampling ────────────────────────────────────────────────
let lastReceived = 0;
export const messageRates: Array<{ timestamp: string; rate: number }> = [];
let metricsInterval: NodeJS.Timeout | null = null;

function startWsMetricsInterval(): void {
  if (metricsInterval) return;
  metricsInterval = setInterval(() => {
    const current = wsMetrics.messagesReceived;
    const rate = current - lastReceived;
    lastReceived = current;
    messageRates.push({ timestamp: new Date().toISOString(), rate });
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

// ── Helpers ──────────────────────────────────────────────────────────────
function recordInbound(event: string, payloadArgs: any[]): void {
  wsMetrics.messagesReceived++;
  wsMetrics.eventsCount[event] = (wsMetrics.eventsCount[event] || 0) + 1;
  try {
    const size = Buffer.byteLength(JSON.stringify(payloadArgs), 'utf8');
    wsMetrics.totalPayloadSize += size;
    if (size > wsMetrics.largestPayloadSize)
      wsMetrics.largestPayloadSize = size;
  } catch {
    /* ignore unserializable */
  }
}

// ── @axiomify/ws RoomManager ─────────────────────────────────────────────
export const roomManagers: any[] = [];

export function clearRoomManagers(): void {
  roomManagers.length = 0;
}

function instrumentAxiomifyWs(
  app?: any,
  moduleExports?: Record<string, any>,
): boolean {
  try {
    const wsPath = require.resolve('@axiomify/ws', { paths: [process.cwd()] });
    const wsPkg = require(wsPath);
    if (!wsPkg?.RoomManager) return false;

    const originalRoomManager = wsPkg.RoomManager;

    // Wrap emit on the prototype — retroactively covers already-created instances
    if (!(originalRoomManager.prototype as any).__axiomifyEmitWrapped) {
      (originalRoomManager.prototype as any).__axiomifyEmitWrapped = true;
      const originalEmit = originalRoomManager.prototype.emit;
      originalRoomManager.prototype.emit = function (
        event: string,
        ...args: any[]
      ) {
        recordInbound(event, args);
        const start = performance.now();
        try {
          const ret = originalEmit.apply(this, [event, ...args]);
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
          if (wsMetrics.failedEvents.length > 50)
            wsMetrics.failedEvents.shift();
          throw err;
        }
      };
    }

    // Proxy constructor so every future `new RoomManager(...)` is tracked
    if (!wsPkg.RoomManager.__axiomifyProxied) {
      const roomManagerProxy = function (this: any, ...args: any[]) {
        const instance = Reflect.construct(
          originalRoomManager,
          args,
          (new.target || originalRoomManager) as any,
        );
        roomManagers.push(instance);
        return instance;
      };
      roomManagerProxy.prototype = originalRoomManager.prototype;
      Object.setPrototypeOf(roomManagerProxy, originalRoomManager);
      (roomManagerProxy as any).__axiomifyProxied = true;
      wsPkg.RoomManager = roomManagerProxy as any;
    }

    // Scan the user's module exports for already-created RoomManager instances
    const exportSources: Record<string, any>[] = [];
    if (moduleExports) exportSources.push(moduleExports);
    // Also try app-level WS route scanning as a secondary heuristic
    if (app) {
      try {
        const wsRoutes: any[] = app.registeredWsRoutes || app._wsRoutes || [];
        for (const route of wsRoutes) {
          const mgr = route._manager || route.manager || route.__manager;
          if (
            mgr &&
            mgr instanceof originalRoomManager &&
            !roomManagers.includes(mgr)
          ) {
            roomManagers.push(mgr);
          }
        }
      } catch {
        /* safe to ignore */
      }
    }

    for (const src of exportSources) {
      try {
        for (const key of Object.keys(src)) {
          const val = src[key];
          if (
            val instanceof originalRoomManager &&
            !roomManagers.includes(val)
          ) {
            roomManagers.push(val);
          }
        }
      } catch {
        /* safe to ignore */
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ── socket.io ────────────────────────────────────────────────────────────
function instrumentSocketIo(): boolean {
  try {
    // Try @axiomify/socket.io first, then the standard socket.io package
    const candidates = ['@axiomify/socket.io', 'socket.io'];
    let sioPath: string | null = null;
    for (const pkg of candidates) {
      try {
        sioPath = require.resolve(pkg, { paths: [process.cwd()] });
        break;
      } catch {
        /* not installed */
      }
    }
    if (!sioPath) return false;

    const sioPkg = require(sioPath);
    // socket.io exports the Server class directly or as .Server
    const ServerClass = sioPkg?.Server || sioPkg?.default?.Server || sioPkg;
    if (typeof ServerClass !== 'function') return false;

    // Hook into the prototype so every Server instance is covered
    const originalOn = ServerClass.prototype.on;
    if ((ServerClass.prototype as any).__axiomifyWrapped) return true;
    (ServerClass.prototype as any).__axiomifyWrapped = true;

    const originalEmit = ServerClass.prototype.emit;
    const originalServerOn = ServerClass.prototype.on;

    // Intercept connection events so we can observe each socket
    ServerClass.prototype.on = function (
      event: string,
      listener: any,
      ...rest: any[]
    ) {
      if (event === 'connection') {
        const wrappedListener = (socket: any) => {
          const id = socket.id || nextSocketId('sio');
          trackConnect(id, 'socket.io');

          // Count inbound messages
          const originalSocketOn = socket.on?.bind(socket);
          if (originalSocketOn) {
            socket.on = function (evtName: string, handler: any) {
              return originalSocketOn(evtName, (...args: any[]) => {
                if (
                  evtName !== 'disconnect' &&
                  evtName !== 'disconnecting' &&
                  evtName !== 'error'
                ) {
                  recordInbound(evtName, args);
                }
                return handler(...args);
              });
            };
          }

          // Count outbound messages
          const originalEmitSocket = socket.emit?.bind(socket);
          if (originalEmitSocket) {
            socket.emit = function (evtName: string, ...args: any[]) {
              wsMetrics.messagesSent++;
              return originalEmitSocket(evtName, ...args);
            };
          }

          socket.on('disconnect', () => trackDisconnect(id));
          return listener(socket);
        };
        return originalServerOn.call(this, event, wrappedListener, ...rest);
      }
      return originalServerOn.call(this, event, listener, ...rest);
    };

    return true;
  } catch {
    return false;
  }
}

// ── native ws package ────────────────────────────────────────────────────
function instrumentNativeWs(): boolean {
  try {
    const wsPath = require.resolve('ws', { paths: [process.cwd()] });
    const wsPkg = require(wsPath);
    const WsServer = wsPkg?.WebSocketServer || wsPkg?.Server;
    if (typeof WsServer !== 'function') return false;

    if ((WsServer.prototype as any).__axiomifyWrapped) return true;
    (WsServer.prototype as any).__axiomifyWrapped = true;

    const originalOn = WsServer.prototype.on;
    WsServer.prototype.on = function (
      event: string,
      listener: any,
      ...rest: any[]
    ) {
      if (event === 'connection') {
        const wrappedListener = (socket: any, req: any) => {
          const id = nextSocketId('ws');
          trackConnect(id, 'ws');

          socket.on('message', (data: any) => {
            recordInbound('message', [data]);
          });

          const originalSend = socket.send?.bind(socket);
          if (originalSend) {
            socket.send = function (data: any, options: any, cb: any) {
              wsMetrics.messagesSent++;
              return originalSend(data, options, cb);
            };
          }

          socket.on('close', () => trackDisconnect(id));
          return listener(socket, req);
        };
        return originalOn.call(this, event, wrappedListener, ...rest);
      }
      return originalOn.call(this, event, listener, ...rest);
    };

    return true;
  } catch {
    return false;
  }
}

// ── Node.js HTTP upgrade fallback ────────────────────────────────────────
// When none of the above packages are used, we listen on every HTTP server's
// 'upgrade' event so at least raw connection/disconnection counts work.
const _patchedServers = new WeakSet<object>();

export function patchHttpServerForWs(httpServer: any): void {
  if (!httpServer || _patchedServers.has(httpServer)) return;
  _patchedServers.add(httpServer);

  httpServer.on('upgrade', (_req: any, socket: any, _head: any) => {
    const id = nextSocketId('http-upgrade');
    trackConnect(id, 'websocket');
    socket.on('close', () => trackDisconnect(id));
    socket.on('error', () => trackDisconnect(id));
  });
}

// ── Main entry ───────────────────────────────────────────────────────────
let isWsAnalyticsInstrumented = false;

export function instrumentWsAnalytics(
  app?: any,
  moduleExports?: Record<string, any>,
): void {
  if (!isWsAnalyticsInstrumented) {
    isWsAnalyticsInstrumented = true;
    instrumentSocketIo();
    instrumentNativeWs();
    startWsMetricsInterval();
  }

  // Always instrument/scan RoomManager because it can be re-created on reload
  instrumentAxiomifyWs(app, moduleExports);
}

// ── API handler ──────────────────────────────────────────────────────────

/**
 * Helper to fetch Prometheus metrics text — tries an HTTP fetch first,
 * then falls back to an in-memory mock request through `app.handle()`.
 */
async function fetchPrometheusText(app?: any): Promise<string | null> {
  // 1. Try external fetch
  try {
    const { getAppBaseUrl } = require('./ws-tester');
    const baseUrl = getAppBaseUrl();
    if (baseUrl) {
      const response = await fetch(`${baseUrl}/metrics`, {
        signal: (AbortSignal as any).timeout
          ? (AbortSignal as any).timeout(800)
          : undefined,
      });
      if (response.ok) {
        return await response.text();
      }
    }
  } catch {
    /* external app not reachable */
  }

  // 2. Fallback: dispatch in-memory mock request via app.handle()
  if (app) {
    try {
      // Find the metrics path from registered routes
      let metricsPath = '/metrics';
      if (Array.isArray(app.registeredRoutes)) {
        const found = app.registeredRoutes.find(
          (r: any) =>
            r.method === 'GET' &&
            (r.path === '/metrics' || r.path.endsWith('/metrics')),
        );
        if (found) metricsPath = found.path;
      }

      const mockReq: any = {
        id: `studio-ws-metrics-${Date.now()}`,
        method: 'GET',
        url: metricsPath,
        path: metricsPath,
        headers: {},
        body: {},
        query: {},
        params: {},
        state: new RequestStateImpl(),
        raw: {},
      };

      let responseBody = '';
      let responseStatus = 200;

      const mockRes: any = {
        status(code: number) {
          responseStatus = code;
          return this;
        },
        sendRaw(data: unknown, _type?: string) {
          responseBody = String(data);
        },
        send(data: unknown) {
          responseBody = String(data);
        },
        header() {
          return this;
        },
        getHeader() {
          return undefined;
        },
        removeHeader() {
          return this;
        },
        capabilities: { sse: false, streaming: false },
        get statusCode() {
          return responseStatus;
        },
        get headersSent() {
          return false;
        },
      };

      const indexed = app as unknown as Record<string, unknown>;
      const handleRequest = (
        indexed['handle'] as (req: unknown, res: unknown) => Promise<void>
      ).bind(app);
      await logCorrelationStorage.run(mockReq.id, () =>
        handleRequest(mockReq, mockRes),
      );

      if (responseStatus === 200 && responseBody) {
        return responseBody;
      }
    } catch {
      /* non-fatal */
    }
  }

  return null;
}

/**
 * Parse WS-related metrics from Prometheus text format.
 */
function parseWsFromPrometheus(text: string): {
  activeConnections: number | null;
  framesReceived: number | null;
  framesSent: number | null;
  rooms: Record<string, number>;
  totalRooms: number;
} {
  const result = {
    activeConnections: null as number | null,
    framesReceived: null as number | null,
    framesSent: null as number | null,
    rooms: {} as Record<string, number>,
    totalRooms: 0,
  };

  const clientsMatch = /ws_connected_clients\s+(\d+)/.exec(text);
  if (clientsMatch) result.activeConnections = parseInt(clientsMatch[1], 10);

  const recMatch = /ws_messages_received_total\s+(\d+)/.exec(text);
  if (recMatch) result.framesReceived = parseInt(recMatch[1], 10);

  const sentMatch = /ws_messages_sent_total\s+(\d+)/.exec(text);
  if (sentMatch) result.framesSent = parseInt(sentMatch[1], 10);

  const roomRegex = /ws_room_clients\{room="([^"]+)"\}\s+(\d+)/g;
  let match;
  while ((match = roomRegex.exec(text)) !== null) {
    result.rooms[match[1]] =
      (result.rooms[match[1]] || 0) + parseInt(match[2], 10);
  }
  result.totalRooms = Object.keys(result.rooms).length;

  return result;
}

export async function handleGetWsAnalytics(
  _req: any,
  res: ServerResponse,
  app?: any,
): Promise<void> {
  // @axiomify/ws RoomManager stats
  let axiomifyConnections = 0;
  let totalRooms = 0;
  const rooms: Record<string, number> = {};
  let axiomifyReceived = 0;
  let axiomifySent = 0;

  roomManagers.forEach((manager) => {
    try {
      axiomifyConnections += manager.clientCount ?? 0;
      totalRooms += manager.roomCount ?? 0;
      manager.clientIds?.forEach((id: string) => {
        if (!trackedSockets.has(id)) {
          const c = manager.client?.(id);
          if (c) trackConnect(id, 'uWS');
        }
      });
      const stats = manager.getStats?.();
      if (stats) {
        if (stats.messagesReceived !== undefined) {
          axiomifyReceived += stats.messagesReceived;
        }
        if (stats.messagesSent !== undefined) {
          axiomifySent += stats.messagesSent;
        }
        if (stats.rooms) {
          Object.entries(stats.rooms).forEach(([name, size]) => {
            rooms[name] = (rooms[name] || 0) + (size as number);
          });
        }
      }
    } catch {
      /* Non-fatal */
    }
  });

  const clients = Array.from(trackedSockets.values());
  let activeConnections = clients.length || axiomifyConnections;

  let totalFramesReceived = wsMetrics.messagesReceived + axiomifyReceived;
  let totalFramesSent = wsMetrics.messagesSent + axiomifySent;

  // Try to query the app's Prometheus metrics (external fetch or in-memory)
  const prometheusText = await fetchPrometheusText(app);
  if (prometheusText) {
    const parsed = parseWsFromPrometheus(prometheusText);

    if (parsed.activeConnections !== null) {
      if (parsed.activeConnections > 0 || activeConnections === 0) {
        activeConnections = parsed.activeConnections;
      }
    }

    if (parsed.framesReceived !== null) {
      totalFramesReceived = Math.max(
        totalFramesReceived,
        parsed.framesReceived,
      );
    }

    if (parsed.framesSent !== null) {
      totalFramesSent = Math.max(totalFramesSent, parsed.framesSent);
    }

    if (parsed.totalRooms > 0) {
      Object.entries(parsed.rooms).forEach(([name, size]) => {
        rooms[name] = (rooms[name] || 0) + size;
      });
      totalRooms = Object.keys(rooms).length;
    }
  }

  sendJson(res, {
    activeConnections,
    totalRooms,
    totalFramesReceived,
    totalFramesSent,
    clients,
    rooms,
    metrics: wsMetrics,
    rates: messageRates,
  });
}
