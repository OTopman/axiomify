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
  authenticate?: (req: IncomingMessage) => Promise<any | null>;
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
    options.server.on(
      'upgrade',
      async (request: IncomingMessage, socket: any, head: Buffer) => {
        if (options.path && request.url !== options.path) return;

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
            client.id = Math.random().toString(36).substring(2, 15);
            client.rooms = new Set();
            client.user = user;

            this.clients.set(client.id, client);
            this.wss.emit('connection', client, request);
          });
        } catch (err) {
          socket.destroy();
        }
      },
    );

    // WS Connection Event
    this.wss.on('connection', (ws: any) => {
      const client = ws as WsClient;

      // WS Message Event
      client.on('message', (rawData: any, isBinary: boolean) => {
        if (isBinary) return;

        try {
          const message = rawData.toString();
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
}

export function useWebSockets(options: WsOptions): WsManager {
  return new WsManager(options);
}
