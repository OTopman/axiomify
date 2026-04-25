import { Axiomify } from '@axiomify/core';
import crypto from 'crypto';
import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ZodTypeAny } from 'zod';

// Make the WsManager type-safe on the Axiomify instance.
declare module '@axiomify/core' {
  interface Axiomify {
    ws?: WsManager;
  }
}

export interface WsClient extends WebSocket {
  id: string;
  rooms: Set<string>;
  user?: any;
  _lastPong: number;
}

export interface WsOptions {
  server: Server;
  path?: string;
  heartbeatIntervalMs?: number;
  maxMessageBytes?: number;
  /**
   * Maximum number of simultaneous WebSocket connections.
   * Upgrade requests beyond this limit are rejected with 503.
   * Default: no limit — set this in production.
   */
  maxConnections?: number;
  authenticate?: (req: IncomingMessage) => Promise<any | null>;
  onBinary?: (client: WsClient, data: Buffer) => void;
}

export interface WsEventSchema {
  [event: string]: ZodTypeAny;
}

export class WsManager {
  public wss: WebSocketServer;
  private clients = new Map<string, WsClient>();
  private rooms = new Map<string, Set<WsClient>>();
  private eventHandlers = new Map<
    string,
    (client: WsClient, data: any) => void
  >();
  private schemas: WsEventSchema = {};
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WsOptions) {
    this.wss = new WebSocketServer({ noServer: true });

    const heartbeatMs = options.heartbeatIntervalMs ?? 30_000;
    const maxConnections = options.maxConnections;

    if (options.server) {
      options.server.on(
        'upgrade',
        async (request: IncomingMessage, socket: any, head: Buffer) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost')
            .pathname;
          if (options.path && pathname !== options.path) return;

          // Enforce connection cap before paying upgrade cost.
          if (
            maxConnections !== undefined &&
            this.clients.size >= maxConnections
          ) {
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
              const client = ws as WsClient;
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

    this.wss.on('connection', (ws: any) => {
      const client = ws as WsClient;

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
    handler: (client: WsClient, data: T) => void,
  ) {
    if (schema) this.schemas[event] = schema;
    this.eventHandlers.set(event, handler as any);
  }

  public joinRoom(client: WsClient, room: string) {
    client.rooms.add(room);
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room)!.add(client);
  }

  public leaveRoom(client: WsClient, room: string) {
    client.rooms.delete(room);
    this.rooms.get(room)?.delete(client);
    if (this.rooms.get(room)?.size === 0) this.rooms.delete(room);
  }

  public broadcastToRoom(room: string, event: string, data: any) {
    const clients = this.rooms.get(room);
    if (!clients) return;
    const payload = JSON.stringify({ event, data });
    clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(payload);
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
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss.close();
  }
}

export function useWebSockets(app: Axiomify, options: WsOptions): void {
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
        'An uncapped WebSocket server can exhaust process memory under connection flood. ' +
        'Set `maxConnections` to a value appropriate for your available memory.',
    );
  }

  const manager = new WsManager(options);
  // Type-safe assignment via module augmentation (no `as any` cast).
  (app as any).ws = manager;
}
