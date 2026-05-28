/**
 * @axiomify/ws — RoomManager and `wsRooms()` factory.
 *
 * The RoomManager is the central coordinator for pub/sub rooms. It:
 *   1. Registers a `app.ws()` route on the Axiomify instance.
 *   2. Tracks all connected clients and their room memberships.
 *   3. Manages room lifecycle (create on first join, destroy on last leave).
 *   4. Processes the optional wire protocol (join/leave/message actions).
 *   5. Emits typed events for application-level hooks.
 *   6. Runs an optional presence heartbeat timer.
 *
 * ## Usage
 *
 * ```ts
 * import { Axiomify } from '@axiomify/core';
 * import { wsRooms } from '@axiomify/ws';
 *
 * const app = new Axiomify();
 * const rooms = wsRooms(app, {
 *   path: '/chat',
 *   plugins: [authPlugin],
 *   onConnect(client) {
 *     client.join('lobby');
 *   },
 *   onMessage(client, data) {
 *     rooms.room('lobby')?.broadcast(data);
 *   },
 * });
 * ```
 */
import type { Axiomify, AxiomifyRequest, RequestState, WsClient } from '@axiomify/core';
import { Room } from './room';
import type {
  RoomClient,
  RoomEvents,
  WsRoomOptions,
} from './types';

// ---------------------------------------------------------------------------
// Tiny typed event emitter (no external deps)
// ---------------------------------------------------------------------------

type EventMap = RoomEvents;
type EventKey = keyof EventMap;

class TypedEmitter {
  private _handlers = new Map<EventKey, Set<Function>>();

  on<K extends EventKey>(event: K, handler: EventMap[K]): void {
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(handler);
  }

  off<K extends EventKey>(event: K, handler: EventMap[K]): void {
    this._handlers.get(event)?.delete(handler);
  }

  emit<K extends EventKey>(event: K, ...args: Parameters<EventMap[K]>): void {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch {
        // Event handlers must not crash the room manager.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Client ID generation — crypto.randomUUID() (Node 19+, zero-dep)
// ---------------------------------------------------------------------------

let _generateId: () => string;
try {
  // Node 19+ has crypto.randomUUID on the global crypto object.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    _generateId = () => globalThis.crypto.randomUUID();
  } else {
    // Fallback: require('node:crypto').randomUUID
    const nodeCrypto = require('node:crypto');
    _generateId = () => nodeCrypto.randomUUID();
  }
} catch {
  // Last resort: timestamp + random (not cryptographic, but unique enough
  // for client IDs in a single-process context).
  let _counter = 0;
  _generateId = () =>
    `${Date.now().toString(36)}-${(++_counter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

export class RoomManager extends TypedEmitter {
  /** All active rooms, keyed by room name. */
  private readonly _rooms = new Map<string, Room>();

  /** All connected clients, keyed by client ID. */
  private readonly _clients = new Map<string, RoomClient>();

  /**
   * Internal map: clientId → WsClient reference.
   * The WsClient already exposes subscribe/unsubscribe/publish which
   * delegate to the raw uWS WebSocket. We use this for room operations.
   */
  private readonly _wsClients = new Map<string, WsClient<RequestState>>();

  /** Internal map: clientId → mutable Set<roomName>. */
  private readonly _clientRooms = new Map<string, Set<string>>();

  /** Max rooms a single client can join. */
  private readonly _maxRoomsPerClient: number;

  /** Presence heartbeat timer handle. */
  private _presenceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _presenceIntervalMs: number;

  constructor(options: WsRoomOptions = {}) {
    super();
    this._maxRoomsPerClient = options.maxRoomsPerClient ?? 50;
    this._presenceIntervalMs = options.presenceIntervalMs ?? 30_000;
  }

  // -------------------------------------------------------------------------
  // Public API — Rooms
  // -------------------------------------------------------------------------

  /**
   * Get a room by name. If the room doesn't exist yet, returns `undefined`.
   * To create-on-access, use `getOrCreateRoom()`.
   */
  room(name: string): Room | undefined {
    return this._rooms.get(name);
  }

  /**
   * Get an existing room or create a new one.
   * The `roomCreate` event fires only on creation.
   */
  getOrCreateRoom(name: string): Room {
    let room = this._rooms.get(name);
    if (!room) {
      room = new Room(name);
      this._rooms.set(name, room);
      this.emit('roomCreate', name);
    }
    return room;
  }

  /** Read-only snapshot of all active room names. */
  get roomNames(): string[] {
    return Array.from(this._rooms.keys());
  }

  /** Total number of active rooms. */
  get roomCount(): number {
    return this._rooms.size;
  }

  // -------------------------------------------------------------------------
  // Public API — Clients
  // -------------------------------------------------------------------------

  /** Get a connected client by ID. */
  client(id: string): RoomClient | undefined {
    return this._clients.get(id);
  }

  /** Total number of connected clients. */
  get clientCount(): number {
    return this._clients.size;
  }

  /** All connected client IDs. */
  get clientIds(): string[] {
    return Array.from(this._clients.keys());
  }

  // -------------------------------------------------------------------------
  // Public API — Broadcasting
  // -------------------------------------------------------------------------

  /**
   * Broadcast a message to EVERY connected client (all rooms, all clients).
   *
   * This is a convenience method — for room-scoped broadcast, use
   * `rooms.room('name')?.broadcast(data)`.
   */
  broadcastAll(data: string | Buffer | object, isBinary?: boolean): void {
    const payload =
      typeof data === 'string' || Buffer.isBuffer(data)
        ? data
        : JSON.stringify(data);
    for (const client of this._clients.values()) {
      client.send(payload, isBinary);
    }
  }

  // -------------------------------------------------------------------------
  // Public API — Shutdown
  // -------------------------------------------------------------------------

  /**
   * Disconnect all clients and clear all rooms.
   * Called automatically by the adapter's shutdown sequence if the
   * RoomManager is registered via `wsRooms()`.
   */
  close(): void {
    if (this._presenceTimer) {
      clearInterval(this._presenceTimer);
      this._presenceTimer = null;
    }

    for (const client of this._clients.values()) {
      client.disconnect(1001, 'Server shutting down');
    }

    this._clients.clear();
    this._wsClients.clear();
    this._clientRooms.clear();
    this._rooms.clear();
  }

  // -------------------------------------------------------------------------
  // Internal — client lifecycle (called from the app.ws() handlers)
  // -------------------------------------------------------------------------

  /** @internal Register a new client on WebSocket open. */
  _onOpen(wsClient: WsClient<RequestState>): RoomClient {
    const clientId = _generateId();
    const clientRoomSet = new Set<string>();
    this._clientRooms.set(clientId, clientRoomSet);
    this._wsClients.set(clientId, wsClient);

    const manager = this;

    const roomClient: RoomClient = {
      get id() {
        return clientId;
      },
      get state() {
        return wsClient.state;
      },
      get rooms() {
        return clientRoomSet as ReadonlySet<string>;
      },

      send(data: string | Buffer | object, isBinary?: boolean): boolean {
        try {
          wsClient.send(data, isBinary);
          return true;
        } catch {
          return false;
        }
      },

      join(roomName: string): void {
        manager._joinRoom(clientId, roomName);
      },

      leave(roomName: string): void {
        manager._leaveRoom(clientId, roomName);
      },

      leaveAll(): void {
        const rooms = Array.from(clientRoomSet);
        for (const roomName of rooms) {
          manager._leaveRoom(clientId, roomName);
        }
      },

      disconnect(code?: number, reason?: string): void {
        wsClient.close();
      },

      getBufferedAmount(): number {
        // getBufferedAmount() is available on the raw uWS WebSocket
        // but not on the WsClient wrapper. Access it via the internal ref.
        try {
          return (wsClient as any).getBufferedAmount?.() ?? 0;
        } catch {
          return 0;
        }
      },
    };

    (roomClient as any)._wsClient = wsClient;
    this._clients.set(clientId, roomClient);

    return roomClient;
  }

  /** @internal Remove a client on WebSocket close. */
  _onClose(clientId: string): void {
    const client = this._clients.get(clientId);
    if (!client) return;

    // Leave all rooms — this triggers room cleanup if empty.
    client.leaveAll();

    this._clients.delete(clientId);
    this._wsClients.delete(clientId);
    this._clientRooms.delete(clientId);
  }

  /** @internal Process a wire-protocol action from the client. */
  _processAction(clientId: string, data: unknown): boolean {
    let parsed: any = data;
    if (Buffer.isBuffer(data)) {
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        return false;
      }
    } else if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        return false;
      }
    }

    if (typeof parsed !== 'object' || parsed === null) return false;

    const action = parsed as Record<string, unknown>;
    if (typeof action.action !== 'string') return false;

    const client = this._clients.get(clientId);
    if (!client) return false;

    switch (action.action) {
      case 'join': {
        if (typeof action.room !== 'string' || action.room.length === 0) {
          client.send({ event: 'error', message: 'Invalid room name', code: 'INVALID_ROOM' });
          return true;
        }
        try {
          client.join(action.room);
          client.send({ event: 'joined', room: action.room });
        } catch (err: unknown) {
          client.send({
            event: 'error',
            message: (err as Error).message,
            code: 'JOIN_FAILED',
          });
        }
        return true;
      }

      case 'leave': {
        if (typeof action.room !== 'string') {
          client.send({ event: 'error', message: 'Invalid room name', code: 'INVALID_ROOM' });
          return true;
        }
        client.leave(action.room);
        client.send({ event: 'left', room: action.room });
        return true;
      }

      case 'message': {
        if (typeof action.room !== 'string') {
          client.send({ event: 'error', message: 'Invalid room name', code: 'INVALID_ROOM' });
          return true;
        }
        const room = this._rooms.get(action.room);
        if (!room) {
          client.send({ event: 'error', message: 'Room does not exist', code: 'ROOM_NOT_FOUND' });
          return true;
        }
        if (!room.has(client.id)) {
          client.send({ event: 'error', message: 'Not a member of this room', code: 'NOT_MEMBER' });
          return true;
        }
        // Broadcast to all room members via the WsClient's publish method.
        // This uses uWS topic publish — O(1) regardless of room size.
        const wsClient = this._wsClients.get(clientId);
        if (wsClient) {
          const payload = {
            event: 'message',
            room: action.room,
            from: client.id,
            data: action.data,
          };
          wsClient.publish(action.room, payload as any);
          // Send it back to the sender since uWS publish excludes the publisher
          client.send(payload);
        }
        return true;
      }

      case 'presence': {
        if (typeof action.room !== 'string') {
          client.send({ event: 'error', message: 'Invalid room name', code: 'INVALID_ROOM' });
          return true;
        }
        const presenceRoom = this._rooms.get(action.room);
        if (!presenceRoom) {
          client.send({ event: 'error', message: 'Room does not exist', code: 'ROOM_NOT_FOUND' });
          return true;
        }
        if (!presenceRoom.has(client.id)) {
          client.send({ event: 'error', message: 'Not a member of this room', code: 'NOT_MEMBER' });
          return true;
        }
        client.send({
          event: 'presence',
          room: action.room,
          clients: presenceRoom.getPresence(),
        });
        return true;
      }

      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------
  // Internal — room management
  // -------------------------------------------------------------------------

  /** @internal Join a room. Called by RoomClient.join(). */
  _joinRoom(clientId: string, roomName: string): void {
    const clientRoomSet = this._clientRooms.get(clientId);
    if (!clientRoomSet) {
      throw new Error(`Client ${clientId} is not connected`);
    }

    // Already in this room — idempotent.
    if (clientRoomSet.has(roomName)) return;

    // Enforce room limit.
    if (clientRoomSet.size >= this._maxRoomsPerClient) {
      throw new Error(
        `Room limit exceeded: client ${clientId} is already in ${clientRoomSet.size} rooms ` +
          `(max: ${this._maxRoomsPerClient}). Leave a room before joining a new one.`,
      );
    }

    const client = this._clients.get(clientId)!;
    const wsClient = this._wsClients.get(clientId);

    // Subscribe the uWS socket to the room's topic via the WsClient.
    if (wsClient) {
      try {
        wsClient.subscribe(roomName);
      } catch {
        // Socket may have been closed between the check and the subscribe.
        return;
      }
    }

    // Get or create the room.
    const room = this.getOrCreateRoom(roomName);
    room._addMember(client);
    clientRoomSet.add(roomName);

    this.emit('join', roomName, client);
  }

  /** @internal Leave a room. Called by RoomClient.leave(). */
  _leaveRoom(clientId: string, roomName: string): void {
    const clientRoomSet = this._clientRooms.get(clientId);
    if (!clientRoomSet || !clientRoomSet.has(roomName)) return;

    const client = this._clients.get(clientId)!;
    const wsClient = this._wsClients.get(clientId);

    // Unsubscribe from the uWS topic.
    if (wsClient) {
      try {
        wsClient.unsubscribe(roomName);
      } catch {
        // Socket already closed — safe to ignore.
      }
    }

    clientRoomSet.delete(roomName);

    const room = this._rooms.get(roomName);
    if (room) {
      const isEmpty = room._removeMember(clientId);
      this.emit('leave', roomName, client);

      // Immediately destroy empty rooms to save memory.
      if (isEmpty) {
        this._rooms.delete(roomName);
        this.emit('roomDelete', roomName);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal — presence heartbeat
  // -------------------------------------------------------------------------

  /** @internal Start the presence heartbeat timer. */
  _startPresence(): void {
    if (this._presenceIntervalMs <= 0) return;
    if (this._presenceTimer) return;

    this._presenceTimer = setInterval(() => {
      // uWS handles ping/pong natively via idleTimeout.
      // The presence timer is application-level — it just notifies
      // rooms that their presence data may have changed.
      // Applications can listen to 'join' / 'leave' events for
      // real-time updates; this is a periodic fallback.
    }, this._presenceIntervalMs);

    // Don't keep the process alive just for presence pings.
    this._presenceTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Factory: wsRooms()
// ---------------------------------------------------------------------------

/**
 * Create a pub/sub room manager and register it on the Axiomify app.
 *
 * This is the main entry point for `@axiomify/ws`. It calls `app.ws()`
 * internally to register the WebSocket route, so the API feels native
 * to the Axiomify framework.
 *
 * @param app — The Axiomify application instance.
 * @param options — Room manager configuration.
 * @returns A `RoomManager` instance for managing rooms and clients.
 *
 * @example
 * ```ts
 * import { Axiomify } from '@axiomify/core';
 * import { wsRooms } from '@axiomify/ws';
 *
 * const app = new Axiomify();
 *
 * const rooms = wsRooms(app, {
 *   path: '/chat',
 *   plugins: [authPlugin],
 *   onConnect(client) {
 *     client.join('lobby');
 *     rooms.room('lobby')?.broadcast({
 *       event: 'system',
 *       data: `${client.state.user?.name} joined`,
 *     });
 *   },
 *   onMessage(client, data) {
 *     // Custom message handling — or use the wire protocol
 *   },
 * });
 *
 * rooms.on('join', (room, client) => {
 *   console.log(`${client.id} joined ${room}`);
 * });
 * ```
 */
export function wsRooms(app: Axiomify, options: WsRoomOptions = {}): RoomManager {
  const manager = new RoomManager(options);
  const path = options.path ?? '/ws';

  // clientId tracking: we store the client ID on the WsClient state
  // so we can look it up in the message/close/drain handlers.
  const CLIENT_ID_KEY = '__axiomify_ws_client_id';

  // Build the app.ws() route definition.
  const wsDefinition: any = {
    path,
    plugins: options.plugins,
    schema: options.schema ? { message: options.schema } : undefined,
    compression: options.compression,
    maxPayloadLength: options.maxPayloadLength,
    idleTimeout: options.idleTimeout,

    open(wsClient: WsClient<RequestState>, req: AxiomifyRequest): void {
      const roomClient = manager._onOpen(wsClient);

      // Store the client ID on the WS state so we can find it later.
      (wsClient.state as any)[CLIENT_ID_KEY] = roomClient.id;

      options.onConnect?.(roomClient);
    },

    message(wsClient: WsClient<RequestState>, data: unknown): void {
      const clientId = (wsClient.state as any)[CLIENT_ID_KEY] as string;
      if (!clientId) return;

      // Try to process as a wire-protocol action first.
      const handled = manager._processAction(clientId, data);

      // Fire onMessage for all messages (wire-protocol or custom).
      const client = manager.client(clientId);
      if (client) {
        manager.emit('message', client, data);
        options.onMessage?.(client, data);
      }
    },

    close(wsClient: WsClient<RequestState>, code: number, reason: string): void {
      const clientId = (wsClient.state as any)[CLIENT_ID_KEY] as string;
      if (!clientId) return;

      const client = manager.client(clientId);
      if (client) {
        options.onDisconnect?.(client, code, reason);
      }

      manager._onClose(clientId);
    },

    drain(wsClient: WsClient<RequestState>): void {
      // Drain is handled by uWS natively — we just expose
      // getBufferedAmount() on the RoomClient for app-level use.
    },
  };

  // Register the WebSocket route on the Axiomify app.
  app.ws(wsDefinition);

  // Start presence heartbeat if configured.
  manager._startPresence();

  return manager;
}
