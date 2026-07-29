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
import type {
  Axiomify,
  AxiomifyRequest,
  RequestState,
  WsClient,
} from '@axiomify/core';
import { wsClientMap } from './client-map';
import { Room } from './room';
import { WS_CTL_CHANNEL, wsRoomChannel } from './broker';
import type {
  WsBroker,
  WsBrokerControlMessage,
  WsBrokerEnvelope,
} from './broker';
import type { RoomClient, RoomEvents, WsRoomOptions } from './types';

// Optional dynamic dependency on @axiomify/security for WebSocket message sanitization
let sanitizeInput: any = null;
try {
  if (typeof require !== 'undefined') {
    sanitizeInput = require('@axiomify/security').sanitizeInput;
  }
} catch {
  // Option not installed/available
}

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

const wsInternals = new WeakMap<
  object,
  { clientId: string; wsClient: WsClient<RequestState> }
>();

/**
 * How long `getGlobalPresence()` waits for `presence:reply` messages on the
 * control channel before aggregating whatever arrived. Pub/sub has no
 * membership registry, so "all nodes have answered" is unknowable — a fixed
 * collection window is the standard trade-off (compare Socket.IO's
 * `requestsTimeout`).
 */
const PRESENCE_QUERY_WINDOW_MS = 250;

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
  private readonly _beforeJoin?: WsRoomOptions['beforeJoin'];
  private readonly _allowlist?: RegExp;

  private _messagesReceived = 0;
  private _messagesSent = 0;

  /** Cross-process broadcast broker (optional). */
  private readonly _broker?: WsBroker;

  /** Messages dropped due to broker publish/subscribe failures. */
  private _brokerDropped = 0;

  /** Lazy control-channel subscription (created once, first use). */
  private _ctlSubscription: Promise<void> | null = null;

  /** In-flight presence queries: requestId → (nodeId → local count). */
  private readonly _presenceWaiters = new Map<string, Map<string, number>>();

  constructor(options: WsRoomOptions = {}) {
    super();
    this._maxRoomsPerClient = options.maxRoomsPerClient ?? 50;
    this._presenceIntervalMs = options.presenceIntervalMs ?? 30_000;
    this._beforeJoin = options.beforeJoin;
    this._allowlist = options.allowlist;
    this._broker = options.broker;

    // Subscribe to the control channel as soon as a broker is configured
    // (not on first getGlobalPresence() call): THIS node must answer
    // presence queries issued by OTHER nodes even if it never queries.
    if (this._broker) {
      this._ensureCtlSubscription().catch((err) => this._brokerFailure(err));
    }
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
  private _validateRoomName(name: string): void {
    if (typeof name !== 'string' || name.length === 0 || name.length > 256) {
      throw new Error(
        'Invalid room name: must be a non-empty string up to 256 characters',
      );
    }
    if (!/^[a-zA-Z0-9_\-.:/@#]+$/.test(name)) {
      throw new Error('Invalid room name: contains illegal characters');
    }
  }

  getOrCreateRoom(name: string): Room {
    this._validateRoomName(name);
    let room = this._rooms.get(name);
    if (!room) {
      room = new Room(name);
      if (this._broker) {
        // Public broadcasts also go to the broker. Messages arriving FROM
        // the broker re-enter through room._localBroadcast(), which never
        // calls this hook — that asymmetry is what prevents echo loops.
        room._forward = (payload, isBinary) =>
          this._forwardToBroker(name, payload, isBinary);
      }
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
   *
   * Reaches every LOCAL client immediately, and — when a `WsBroker` is
   * configured — every client on every other node too, via the same control
   * channel `getGlobalPresence()` uses. Without a broker this only ever
   * reached the local process; that was silently true before, but is now
   * also cluster-wide when one is configured, matching this method's
   * documented "EVERY connected client" contract.
   */
  broadcastAll(data: string | Buffer | object, isBinary?: boolean): void {
    const payload =
      typeof data === 'string' || Buffer.isBuffer(data)
        ? data
        : JSON.stringify(data);
    for (const client of this._clients.values()) {
      client.send(payload, isBinary);
    }
    this._forwardBroadcastAllToBroker(payload, isBinary);
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

    // Tear down the broker: unsubscribes every room + control channel.
    // Best-effort — the transport may already be gone during shutdown.
    this._presenceWaiters.clear();
    if (this._broker) {
      this._ctlSubscription = null;
      Promise.resolve(this._broker.close()).catch(() => {
        // Shutdown path — nothing useful left to report.
      });
    }
  }

  /**
   * Get dynamic statistics of active rooms and connections.
   * Required for integration with @axiomify/metrics.
   */
  getStats(): {
    connectedClients: number;
    rooms: Record<string, number>;
    messagesReceived?: number;
    messagesSent?: number;
    brokerDropped?: number;
  } {
    const roomsStats: Record<string, number> = {};
    for (const [name, room] of this._rooms.entries()) {
      roomsStats[name] = room.size;
    }
    return {
      connectedClients: this.clientCount,
      rooms: roomsStats,
      messagesReceived: this._messagesReceived,
      messagesSent: this._messagesSent,
      brokerDropped: this._brokerDropped,
    };
  }

  // -------------------------------------------------------------------------
  // Public API — Cross-process presence
  // -------------------------------------------------------------------------

  /**
   * Cluster-wide presence for a room, aggregated across all workers.
   *
   * Publishes a `presence:query` on the `axiomify:ws:ctl` control channel,
   * then collects `presence:reply` messages — from every node, INCLUDING
   * this one (a broker delivers self-published messages, so this node
   * answers its own query through the exact same path as its peers) — for
   * a fixed 250 ms window.
   *
   * Returns `{ nodes, total }`: how many nodes replied within the window
   * and the sum of their local member counts.
   *
   * ## Eventual consistency
   *
   * Pub/sub is fire-and-forget: there is no registry of live nodes, so the
   * result is a best-effort snapshot, not a linearizable count.
   *
   *   - A node slower than the 250 ms window is silently missing.
   *   - Clients joining/leaving mid-query may or may not be counted.
   *   - A crashed node's clients disappear from the total only after its
   *     sockets actually die.
   *
   * Without a configured broker (or if the query cannot be published) this
   * degrades gracefully to the local view: `{ nodes: 1, total: <local> }`.
   */
  async getGlobalPresence(
    room: string,
  ): Promise<{ nodes: number; total: number }> {
    const localCount = this._rooms.get(room)?.size ?? 0;
    const broker = this._broker;
    if (!broker) {
      return { nodes: 1, total: localCount };
    }

    const replies = new Map<string, number>();
    const requestId = _generateId();

    try {
      await this._ensureCtlSubscription();

      this._presenceWaiters.set(requestId, replies);

      const query: WsBrokerControlMessage = {
        nodeId: broker.nodeId,
        type: 'presence:query',
        id: requestId,
        room,
      };
      await broker.publish(WS_CTL_CHANNEL, JSON.stringify(query));
    } catch (err) {
      this._presenceWaiters.delete(requestId);
      this._brokerFailure(err);
      return { nodes: 1, total: localCount };
    }

    // Fixed collection window — see PRESENCE_QUERY_WINDOW_MS.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PRESENCE_QUERY_WINDOW_MS);
      timer.unref?.();
    });

    this._presenceWaiters.delete(requestId);

    if (replies.size === 0) {
      // Even the self-reply didn't make it back — fall back to local view.
      return { nodes: 1, total: localCount };
    }

    let total = 0;
    for (const count of replies.values()) total += count;
    return { nodes: replies.size, total };
  }

  // -------------------------------------------------------------------------
  // Internal — cross-process broker bridge
  // -------------------------------------------------------------------------

  /**
   * @internal Record a broker failure. Broker errors must NEVER crash the
   * message path: local delivery has already happened (or proceeds) — the
   * failure is surfaced through the manager's `error` event (the package's
   * logging channel; TypedEmitter isolates handler throws) and counted in
   * `getStats().brokerDropped`.
   */
  private _brokerFailure(err: unknown): void {
    this._brokerDropped++;
    this.emit('error', err instanceof Error ? err : new Error(String(err)));
  }

  /**
   * @internal Room._forward hook target: wrap a public broadcast in a
   * WsBrokerEnvelope and publish it on the room's broker channel.
   * Binary payloads are base64-encoded (Buffers don't survive JSON);
   * the original frame flag travels separately as `isBinary`.
   */
  private _forwardToBroker(
    roomName: string,
    payload: string | Buffer,
    isBinary?: boolean,
  ): void {
    const broker = this._broker;
    if (!broker) return;
    try {
      const binary = Buffer.isBuffer(payload);
      const envelope: WsBrokerEnvelope = {
        nodeId: broker.nodeId,
        room: roomName,
        event: 'broadcast',
        data: binary
          ? (payload as Buffer).toString('base64')
          : (payload as string),
        ...(binary ? { binary: true } : {}),
        ...(isBinary !== undefined ? { isBinary } : {}),
      };
      Promise.resolve(
        broker.publish(wsRoomChannel(roomName), JSON.stringify(envelope)),
      ).catch((err) => this._brokerFailure(err));
    } catch (err) {
      this._brokerFailure(err);
    }
  }

  /**
   * @internal Forward a `broadcastAll()` payload to every other node over
   * the control channel. Mirrors `_forwardToBroker`'s envelope shape (binary
   * payloads base64-encoded, self-drop by `nodeId` on receipt) but uses
   * `axiomify:ws:ctl` instead of a per-room channel — `broadcastAll()` has
   * no room to scope a channel to.
   */
  private _forwardBroadcastAllToBroker(
    payload: string | Buffer,
    isBinary?: boolean,
  ): void {
    const broker = this._broker;
    if (!broker) return;
    try {
      const binary = Buffer.isBuffer(payload);
      const msg: WsBrokerControlMessage = {
        nodeId: broker.nodeId,
        type: 'broadcast:all',
        id: _generateId(),
        data: binary
          ? (payload as Buffer).toString('base64')
          : (payload as string),
        ...(binary ? { binary: true } : {}),
        ...(isBinary !== undefined ? { isBinary } : {}),
      };
      Promise.resolve(
        broker.publish(WS_CTL_CHANNEL, JSON.stringify(msg)),
      ).catch((err) => this._brokerFailure(err));
    } catch (err) {
      this._brokerFailure(err);
    }
  }

  /**
   * @internal Handler for messages on `axiomify:ws:room:<room>` channels.
   *
   * Drops envelopes published by THIS node (`nodeId` match) — the local
   * broadcast already happened before forwarding, so re-delivering would
   * duplicate. Remote envelopes re-enter via `Room._localBroadcast()`,
   * which never forwards back to the broker: no echo loops.
   */
  private readonly _onBrokerRoomMessage = (payload: string | Buffer): void => {
    const broker = this._broker;
    if (!broker) return;
    try {
      const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
      const envelope = JSON.parse(raw) as WsBrokerEnvelope;
      if (
        !envelope ||
        envelope.event !== 'broadcast' ||
        typeof envelope.room !== 'string' ||
        typeof envelope.data !== 'string'
      ) {
        return; // Not ours — ignore foreign traffic on the channel.
      }
      if (envelope.nodeId === broker.nodeId) return; // Self — drop.

      const room = this._rooms.get(envelope.room);
      if (!room) return; // No local members — nothing to deliver.

      const data = envelope.binary
        ? Buffer.from(envelope.data, 'base64')
        : envelope.data;
      room._localBroadcast(data, envelope.isBinary);
    } catch (err) {
      this._brokerFailure(err);
    }
  };

  /**
   * @internal Subscribe to the `axiomify:ws:ctl` control channel exactly
   * once (lazy, promise-cached; reset on failure so it can be retried).
   */
  private _ensureCtlSubscription(): Promise<void> {
    const broker = this._broker;
    if (!broker) return Promise.resolve();
    if (!this._ctlSubscription) {
      this._ctlSubscription = Promise.resolve(
        broker.subscribe(WS_CTL_CHANNEL, this._onCtlMessage),
      ).catch((err) => {
        this._ctlSubscription = null;
        throw err;
      });
    }
    return this._ctlSubscription;
  }

  /**
   * @internal Handler for the control channel.
   *
   * `presence:query` → always answer with this node's local presence for
   * the room (including for our OWN queries — that is how the querying
   * node counts itself). `presence:reply` → recorded against the pending
   * request, if any; replies to other nodes' requests are ignored.
   */
  private readonly _onCtlMessage = (payload: string | Buffer): void => {
    const broker = this._broker;
    if (!broker) return;
    try {
      const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
      const msg = JSON.parse(raw) as WsBrokerControlMessage;
      if (!msg || typeof msg !== 'object' || typeof (msg as any).id !== 'string') {
        return;
      }

      if (msg.type === 'presence:query') {
        if (typeof msg.room !== 'string') return;
        const reply: WsBrokerControlMessage = {
          nodeId: broker.nodeId,
          type: 'presence:reply',
          id: msg.id,
          room: msg.room,
          clients: this._rooms.get(msg.room)?.getPresence() ?? [],
        };
        Promise.resolve(
          broker.publish(WS_CTL_CHANNEL, JSON.stringify(reply)),
        ).catch((err) => this._brokerFailure(err));
        return;
      }

      if (msg.type === 'presence:reply') {
        const waiter = this._presenceWaiters.get(msg.id);
        if (waiter) {
          waiter.set(
            msg.nodeId,
            Array.isArray(msg.clients) ? msg.clients.length : 0,
          );
        }
        return;
      }

      if (msg.type === 'broadcast:all') {
        if (msg.nodeId === broker.nodeId) return; // Self — already delivered locally.
        if (typeof msg.data !== 'string') return;
        const data = msg.binary ? Buffer.from(msg.data, 'base64') : msg.data;
        for (const client of this._clients.values()) {
          client.send(data, msg.isBinary);
        }
      }
    } catch (err) {
      this._brokerFailure(err);
    }
  };

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

    // Track messages sent at transport level by proxying publish
    if (
      wsClient &&
      typeof wsClient.publish === 'function' &&
      !(wsClient as any).__axiomifyWrapped
    ) {
      const originalPublish = wsClient.publish;
      (wsClient as any).__axiomifyWrapped = true;
      wsClient.publish = function (
        topic: string,
        data: any,
        isBinary?: boolean,
      ) {
        const room = manager.room(topic);
        const count = room ? room.size : 1;
        manager._messagesSent += count;
        return originalPublish.call(this, topic, data, isBinary);
      };
    }

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
          manager._messagesSent++;
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
          return (
            (
              wsClient as WsClient<RequestState> & {
                getBufferedAmount?: () => number;
              }
            ).getBufferedAmount?.() ?? 0
          );
        } catch {
          return 0;
        }
      },
    };

    wsClientMap.set(roomClient, wsClient);
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

  _processAction(clientId: string, data: unknown): boolean {
    this._messagesReceived++;
    let parsed: any;
    if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
      parsed = data;
    } else if (Buffer.isBuffer(data)) {
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
    } else {
      return false;
    }

    if (typeof parsed !== 'object' || parsed === null) return false;

    const action = parsed as Record<string, unknown>;
    if (typeof action.action !== 'string') return false;

    const client = this._clients.get(clientId);
    if (!client) return false;

    switch (action.action) {
      case 'join': {
        if (typeof action.room !== 'string' || action.room.length === 0) {
          client.send({
            event: 'error',
            message: 'Invalid room name',
            code: 'INVALID_ROOM',
          });
          return true;
        }

        const room = action.room as string;

        const runJoin = async () => {
          try {
            const wsClient = this._wsClients.get(clientId);
            if (!wsClient) throw new Error('Client not found');

            let allowed = false;
            try {
              if (this._beforeJoin) {
                allowed = await this._beforeJoin(wsClient, room);
              } else if (this._allowlist) {
                allowed = this._allowlist.test(room);
              } else {
                allowed = false;
              }
            } catch (authErr) {
              client.send({
                error: 'Unauthorized',
                code: 'ROOM_JOIN_FORBIDDEN',
              });
              return;
            }

            if (!allowed) {
              client.send({
                error: 'Unauthorized',
                code: 'ROOM_JOIN_FORBIDDEN',
              });
              return;
            }

            try {
              this._joinRoom(clientId, room);
              client.send({ event: 'joined', room });
            } catch (err: any) {
              client.send({
                event: 'error',
                message: err.message,
                code: 'JOIN_FAILED',
              });
            }
          } catch (err: any) {
            client.send({
              event: 'error',
              message: err.message,
              code: 'JOIN_FAILED',
            });
          }
        };

        runJoin();
        return true;
      }

      case 'leave': {
        if (typeof action.room !== 'string') {
          client.send({
            event: 'error',
            message: 'Invalid room name',
            code: 'INVALID_ROOM',
          });
          return true;
        }
        client.leave(action.room);
        client.send({ event: 'left', room: action.room });
        return true;
      }

      case 'message': {
        if (typeof action.room !== 'string') {
          client.send({
            event: 'error',
            message: 'Invalid room name',
            code: 'INVALID_ROOM',
          });
          return true;
        }
        const room = this._rooms.get(action.room);
        if (!room) {
          client.send({
            event: 'error',
            message: 'Room does not exist',
            code: 'ROOM_NOT_FOUND',
          });
          return true;
        }
        if (!room.has(client.id)) {
          client.send({
            event: 'error',
            message: 'Not a member of this room',
            code: 'NOT_MEMBER',
          });
          return true;
        }
        // Broadcast to all room members via the WsClient's publish method.
        // This uses uWS topic publish — O(1) regardless of room size.
        const wsClient = this._wsClients.get(clientId);
        const payload = {
          event: 'message',
          room: action.room,
          from: client.id,
          data: action.data,
        };
        const payloadStr = JSON.stringify(payload);
        if (wsClient) {
          wsClient.publish(action.room, payloadStr);
          // Send it back to the sender since uWS publish excludes the publisher
          client.send(payloadStr);
        } else {
          const roomObj = this._rooms.get(action.room);
          roomObj?._localBroadcast(payloadStr);
        }
        // Forward to the cross-process broker (if configured) so clients on other nodes receive it
        const roomObj = this._rooms.get(action.room);
        roomObj?._forward?.(payloadStr);
        return true;
      }

      case 'presence': {
        if (typeof action.room !== 'string') {
          client.send({
            event: 'error',
            message: 'Invalid room name',
            code: 'INVALID_ROOM',
          });
          return true;
        }
        const presenceRoom = this._rooms.get(action.room);
        if (!presenceRoom) {
          client.send({
            event: 'error',
            message: 'Room does not exist',
            code: 'ROOM_NOT_FOUND',
          });
          return true;
        }
        if (!presenceRoom.has(client.id)) {
          client.send({
            event: 'error',
            message: 'Not a member of this room',
            code: 'NOT_MEMBER',
          });
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
    this._validateRoomName(roomName);
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

    // First LOCAL member → subscribe to the room's broker channel.
    // Local membership count is the refcount: subsequent joins reuse the
    // subscription; the last leave (room destroyed) tears it down.
    if (this._broker && room.size === 1) {
      Promise.resolve(
        this._broker.subscribe(wsRoomChannel(roomName), this._onBrokerRoomMessage),
      ).catch((err) => this._brokerFailure(err));
    }

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

        // Last LOCAL member left → drop the broker subscription (refcount
        // reached zero). Other nodes keep their own subscriptions.
        if (this._broker) {
          Promise.resolve(
            this._broker.unsubscribe(wsRoomChannel(roomName)),
          ).catch((err) => this._brokerFailure(err));
        }

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
export function wsRooms(
  app: Axiomify,
  options: WsRoomOptions = {},
): RoomManager {
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

      // Store the client ID and wsClient in the WeakMap.
      wsInternals.set(wsClient.state, { clientId: roomClient.id, wsClient });

      options.onConnect?.(roomClient);
    },

    message(wsClient: WsClient<RequestState>, data: unknown): void {
      const internals = wsInternals.get(wsClient.state);
      const clientId = internals?.clientId;
      if (!clientId) return;

      let sanitizedData = data;
      if (options.sanitize !== false && sanitizeInput) {
        const sanitizeOpts =
          typeof options.sanitize === 'object' ? options.sanitize : undefined;
        sanitizedData = sanitizeInput(data, sanitizeOpts);
      }

      // Try to process as a wire-protocol action first.
      const handled = manager._processAction(clientId, sanitizedData);

      // Fire onMessage for all messages (wire-protocol or custom).
      const client = manager.client(clientId);
      if (client) {
        manager.emit('message', client, sanitizedData);
        options.onMessage?.(client, sanitizedData);
      }
    },

    close(
      wsClient: WsClient<RequestState>,
      code: number,
      reason: string,
    ): void {
      const internals = wsInternals.get(wsClient.state);
      const clientId = internals?.clientId;
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
  wsDefinition.manager = manager;
  app.ws(wsDefinition);

  // Start presence heartbeat if configured.
  manager._startPresence();

  return manager;
}
