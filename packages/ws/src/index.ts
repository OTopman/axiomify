import { Axiomify } from '@axiomify/core';
import crypto from 'crypto';
import type { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ZodTypeAny } from 'zod';

export interface WsClient extends WebSocket {
  id: string;
  rooms: Set<string>;
  user?: any;
}

export interface WsOptions {
  server: Server;
  path?: string;
  heartbeatIntervalMs?: number; // default 30_000
  maxMessageBytes?: number; // default 65_536
  authenticate?: (req: IncomingMessage) => Promise<any | null>;
  /**
   * Optional handler for binary frames. If omitted, binary frames are
   * silently ignored instead of being run through JSON.parse (which
   * incorrectly produced a "Malformed payload" error for perfectly valid
   * binary data).
   */
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

  constructor(options: WsOptions) {
    this.wss = new WebSocketServer({ noServer: true });

    // WS Upgrade Callback
    if (options.server) {
      options.server.on(
        'upgrade',
        async (request: IncomingMessage, socket: any, head: Buffer) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost')
            .pathname;
          if (options.path && pathname !== options.path) return;

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

            // WS Upgrade Callback
            this.wss.handleUpgrade(request, socket, head, (ws: any) => {
              const client = ws as WsClient;
              client.id = crypto.randomUUID();
              client.rooms = new Set();
              client.user = user;

              this.clients.set(client.id, client);
              this.wss.emit('connection', client, request);
            });
          } catch (err) {
            console.error('[axiomify/ws] Upgrade error:', err);
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            socket.destroy();
            return;
          }
        },
      );
    }

    // WS Connection Event
    this.wss.on('connection', (ws: any) => {
      const client = ws as WsClient;

      let lastPong = Date.now();
      client.on('pong', () => {
        lastPong = Date.now();
      });

      const heartbeat =
        options.heartbeatIntervalMs !== 0
          ? setInterval(() => {
              if (
                Date.now() - lastPong >
                (options.heartbeatIntervalMs ?? 30_000) * 2
              )
                return client.terminate();
              client.ping();
            }, options.heartbeatIntervalMs ?? 30_000)
          : null;

      // `ws` emits `message(data, isBinary)` in v8+. We branch on `isBinary`
      // so binary frames are routed to `onBinary` (or ignored) rather than
      // being fed through JSON.parse and rejected as "Malformed payload".
      client.on('message', (rawData: Buffer, isBinary: boolean) => {
        if (Buffer.byteLength(rawData) > (options.maxMessageBytes ?? 65_536)) {
          client.send(JSON.stringify({ error: 'Message too large' }));
          return client.close(1009); // RFC 6455
        }

        if (isBinary) {
          if (options.onBinary) options.onBinary(client, rawData);
          return;
        }

        try {
          const message = rawData.toString('utf8');
          const parsed = JSON.parse(message);
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
        } catch (e) {
          client.send(JSON.stringify({ error: 'Malformed payload' }));
        }
      });

      client.on('close', () => {
        heartbeat && clearInterval(heartbeat);
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
}

/**
 * Registers the WebSocket plugin.
 * Now explicitly returns void to satisfy the Axiomify plugin signature.
 */
export function useWebSockets(app: Axiomify, options: WsOptions): void {
  // Ensure the server is provided
  if (!options.server) {
    console.warn(
      '[axiomify/ws] No server provided in options. ' +
        'WebSocket upgrade listeners will not be attached.',
    );
  }

  // Initialize the manager (this attaches the 'upgrade' listener to options.server)
  const manager = new WsManager(options);

  // Expose the manager to the app context if needed for route handlers,
  // but do NOT return it from this function.
  (app as any).ws = manager;
}
