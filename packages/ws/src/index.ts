import type { Axiomify } from '@axiomify/core';
import crypto from 'crypto';
import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ZodTypeAny } from 'zod';

export interface WsClient<TUser = unknown> extends WebSocket {
  id: string;
  rooms: Set<string>;
  user?: TUser;
  _lastPong: number;
}

export interface WsOptions<TUser = unknown> {
  server: Server;
  path?: string;
  heartbeatIntervalMs?: number;
  maxMessageBytes?: number;
  /**
   * Maximum number of simultaneous WebSocket connections.
   * Upgrade requests beyond this limit are rejected with 503.
   * Default: 10_000. Set higher for large deployments, or Infinity explicitly to disable.
   */
  maxConnections?: number;
  /**
   * Maximum queued outbound bytes before broadcasts to a client are skipped.
   * Prevents slow consumers from growing memory without bound.
   */
  maxBufferedBytes?: number;
  authenticate?: (req: IncomingMessage) => Promise<TUser | null>;
  onBinary?: (client: WsClient<TUser>, data: Buffer) => void;
}

export interface WsEventSchema {
  [event: string]: ZodTypeAny;
}

const MAX_CONNECTIONS_DEFAULT = 10_000;

export class WsManager<TUser = unknown> {
  public wss: WebSocketServer;
  private clients = new Map<string, WsClient<TUser>>();
  private rooms = new Map<string, Set<WsClient<TUser>>>();
  private eventHandlers = new Map<
    string,
    (client: WsClient<TUser>, data: any) => void
  >();
  private schemas: WsEventSchema = {};
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly maxBufferedBytes: number;

  constructor(options: WsOptions<TUser>) {
    this.wss = new WebSocketServer({ noServer: true });

    const heartbeatMs = options.heartbeatIntervalMs ?? 30_000;
    
    this.maxBufferedBytes = options.maxBufferedBytes ?? 1_048_576;

    if (options.server) {
      options.server.on(
        'upgrade',
        async (request: IncomingMessage, socket: any, head: Buffer) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost')
            .pathname;
          if (options.path && pathname !== options.path) return;

          // Enforce connection cap before paying upgrade cost.
          const limit = options.maxConnections ?? MAX_CONNECTIONS_DEFAULT;
          if (this.wss.clients.size >= limit) {
            socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
            socket.destroy();
            return;
          }

          try {
            let user = undefined;
            if (options.authenticate) {
              user = await options.authenticate(request);
              if (!user) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
              }
            }

            this.wss.handleUpgrade(request, socket, head, (ws: any) => {
              const client = ws as WsClient<TUser>;
              client.id = crypto.randomUUID();
              client.rooms = new Set();
              client.user = user;
              client._lastPong = Date.now();

              this.clients.set(client.id, client);
              this.wss.emit('connection', client, request);
            });
          } catch (err) {
            // Avoid leaking internals — log at debug level only.
            if (process.env.NODE_ENV !== 'production') {
              console.error('[axiomify/ws] Upgrade error:', err);
            }
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            socket.destroy();
          }
        },
      );
    }

    // One shared heartbeat timer that iterates all clients — O(n) per interval
    // instead of one setInterval per client which puts O(n) timers in the heap.
    if (heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        const staleThreshold = Date.now() - heartbeatMs * 2;
        for (const client of this.clients.values()) {
          if (client._lastPong < staleThreshold) {
            client.terminate();
            continue;
          }
          if (client.readyState === WebSocket.OPEN) {
            client.ping();
          }
        }
      }, heartbeatMs);
      this.heartbeatTimer.unref();
    }

    // Clear the heartbeat timer if the WebSocket server itself encounters a
    // fatal error (e.g. port bind failure during startup, unexpected close).
    // Without this, the setInterval holds a reference and the process cannot exit.
    this.wss.on('error', () => this._stopHeartbeat());
    this.wss.on('close', () => this._stopHeartbeat());

    this.wss.on('connection', (ws: any) => {
      const client = ws as WsClient<TUser>;
      if (!client.id) client.id = crypto.randomUUID();
      if (!client.rooms) client.rooms = new Set();
      if (!this.clients.has(client.id)) this.clients.set(client.id, client);
      if (!client._lastPong) client._lastPong = Date.now();

      client.on('pong', () => {
        client._lastPong = Date.now();
      });

      client.on('message', (rawData: Buffer, isBinary: boolean) => {
        if (Buffer.byteLength(rawData) > (options.maxMessageBytes ?? 65_536)) {
          client.send(JSON.stringify({ error: 'Message too large' }));
          client.close(1009);
          return;
        }

        if (isBinary) {
          if (options.onBinary) options.onBinary(client, rawData);
          return;
        }

        try {
          const parsed = JSON.parse(rawData.toString('utf8'));
          const { event, data } = parsed;

          if (!event || !this.eventHandlers.has(event)) return;

          if (this.schemas[event]) {
            const result = this.schemas[event].safeParse(data);
            if (!result.success) {
              client.send(
                JSON.stringify({
                  error: 'Validation failed',
                  details: result.error.format(),
                }),
              );
              return;
            }
            this.eventHandlers.get(event)!(client, result.data);
          } else {
            this.eventHandlers.get(event)!(client, data);
          }
        } catch {
          client.send(JSON.stringify({ error: 'Malformed payload' }));
        }
      });

      client.on('close', () => {
        this.clients.delete(client.id);
        client.rooms.forEach((room) => this.leaveRoom(client, room));
      });
    });
  }

  public on<T = any>(
    event: string,
    schema: ZodTypeAny | null,
    handler: (client: WsClient<TUser>, data: T) => void,
  ) {
    if (schema) this.schemas[event] = schema;
    this.eventHandlers.set(event, handler as any);
  }

  public joinRoom(client: WsClient<TUser>, room: string) {
    client.rooms.add(room);
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room)!.add(client);
  }

  public leaveRoom(client: WsClient<TUser>, room: string) {
    client.rooms.delete(room);
    this.rooms.get(room)?.delete(client);
    if (this.rooms.get(room)?.size === 0) this.rooms.delete(room);
  }

  public broadcastToRoom(room: string, event: string, data: any) {
    const clients = this.rooms.get(room);
    if (!clients) return;
    const payload = JSON.stringify({ event, data });
    clients.forEach((c) => {
      if (
        c.readyState === WebSocket.OPEN &&
        (c.bufferedAmount ?? 0) <= this.maxBufferedBytes
      ) {
        c.send(payload);
      }
    });
  }

  public getStats(): {
    connectedClients: number;
    rooms: Record<string, number>;
  } {
    const rooms: Record<string, number> = {};
    for (const [name, members] of this.rooms.entries())
      rooms[name] = members.size;
    return { connectedClients: this.clients.size, rooms };
  }

  /** Call this during graceful shutdown to close all connections cleanly. */
  public close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wss.close();
  }

  /** @internal — stops the heartbeat timer and clears state without closing wss */
  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export function useWebSockets<TUser = unknown>(app: Axiomify, options: WsOptions<TUser>): void {
  if (!options.server) {
    console.warn(
      '[axiomify/ws] No server provided. WebSocket upgrade listeners will not be attached.',
    );
  }

  if (
    options.maxConnections === undefined &&
    process.env.NODE_ENV === 'production'
  ) {
    console.warn(
      '[axiomify/ws] No `maxConnections` limit set. ' +
        'Defaulting to 10000 in production. Set an explicit value appropriate ' +
        'for your available memory.',
    );
  }

  const manager = new WsManager<TUser>(options);
  setWsManager(app, manager);
}

// ─── Adapter extraction helpers ───────────────────────────────────────────────
// @axiomify/ws requires a raw `http.Server` to attach WebSocket upgrade
// listeners. Each adapter wraps a different underlying server type. These
// helpers extract the underlying server so `WsManager` works with any adapter.

/**
 * Extract the underlying `http.Server` from any Axiomify adapter, then pass
 * it to `WsManager` or `useWebSockets`.
 *
 * @example
 * // Express
 * const server = adapter.listen(3000);
 * useWebSockets(app, { server, path: '/ws' });
 *
 * // Fastify
 * await adapter.listen(3000);
 * const server = getServerFromAdapter(adapter);
 * useWebSockets(app, { server, path: '/ws' });
 */
export function getServerFromAdapter(adapter: unknown): Server {
  const a = adapter as Record<string, unknown>;

  // @axiomify/http — HttpAdapter.listen() returns the server
  if (a['server'] && typeof (a['server'] as { on?: unknown }).on === 'function') {
    return a['server'] as Server;
  }

  // @axiomify/express — ExpressAdapter.native is the Express app;
  // the server is available after listen() is called
  if (a['server'] && (a['server'] as { listening?: boolean }).listening !== undefined) {
    return a['server'] as Server;
  }

  // @axiomify/fastify — underlying server is at app.server (Fastify instance)
  const fastifyApp = a['app'] as Record<string, unknown> | undefined;
  if (fastifyApp?.['server']) {
    return fastifyApp['server'] as Server;
  }

  // @axiomify/hapi — Hapi exposes .server.listener
  const hapiServer = a['server'] as Record<string, unknown> | undefined;
  if (hapiServer?.['listener']) {
    return hapiServer['listener'] as Server;
  }

  throw new Error(
    '[axiomify/ws] Could not extract http.Server from adapter. ' +
      'Pass the server manually: `useWebSockets(app, { server: yourHttpServer })`.',
  );
}

const WS_MANAGER_KEY = Symbol.for('axiomify.ws.manager');

export function setWsManager<TUser = unknown>(
  app: Axiomify,
  manager: WsManager<TUser>,
): void {
  (app as unknown as Record<symbol, unknown>)[WS_MANAGER_KEY] = manager;
}

export function getWsManager<TUser = unknown>(
  app: Axiomify,
): WsManager<TUser> | undefined {
  return (app as unknown as Record<symbol, unknown>)[
    WS_MANAGER_KEY
  ] as WsManager<TUser> | undefined;
}
