/**
 * @axiomify/ws — Core type definitions.
 *
 * This file defines the public-facing types for the native pub/sub room
 * utility. Every type here is part of the stable API surface.
 */
import type { RouteMiddleware, WsClient } from '@axiomify/core';
import type { ZodTypeAny } from 'zod';

// ---------------------------------------------------------------------------
// RoomClient — a connected WebSocket client with room-aware extensions
// ---------------------------------------------------------------------------

/**
 * A connected WebSocket client enriched with room-level operations.
 *
 * The underlying transport is a uWebSockets.js WebSocket — `subscribe`,
 * `publish`, and `getBufferedAmount` map directly to uWS C++ calls with
 * zero JavaScript intermediary.
 */
export interface RoomClient {
  /** Unique client identifier (UUID v4, assigned on connect). */
  readonly id: string;

  /**
   * Shared state carried from the HTTP→WS upgrade handshake.
   * Populated by Axiomify route plugins (auth, fingerprint, etc).
   */
  readonly state: Record<string, any>;

  /** Set of room names this client is currently a member of. */
  readonly rooms: ReadonlySet<string>;

  /**
   * Send a message to this specific client.
   *
   * Objects are auto-serialised to JSON. Strings and Buffers are sent
   * as-is. Returns `true` if the message was queued successfully.
   */
  send(data: string | Buffer | object, isBinary?: boolean): boolean;

  /**
   * Join a room. If the room does not exist it is created automatically.
   * Subscribes the underlying uWS socket to the room's topic — all
   * future `room.broadcast()` calls reach this client at O(1) cost.
   *
   * @throws If the client has reached `maxRoomsPerClient`.
   */
  join(room: string): void;

  /**
   * Leave a room. If this was the last client the room is destroyed
   * immediately (no TTL — saves memory per user requirement).
   */
  leave(room: string): void;

  /** Leave all rooms this client is currently in. */
  leaveAll(): void;

  /** Disconnect the client gracefully. */
  disconnect(code?: number, reason?: string): void;

  /**
   * Bytes currently buffered in the send queue.
   *
   * Use this to implement application-level backpressure:
   * ```ts
   * if (client.getBufferedAmount() > 1024 * 64) {
   *   // skip sending non-critical updates
   * }
   * ```
   */
  getBufferedAmount(): number;
}

// ---------------------------------------------------------------------------
// Room events — typed event map for the RoomManager emitter
// ---------------------------------------------------------------------------

/** Typed event map for `RoomManager.on(event, handler)`. */
export interface RoomEvents {
  /** Fired when a client joins a room. */
  join: (roomName: string, client: RoomClient) => void;

  /** Fired when a client leaves a room (voluntary or disconnect). */
  leave: (roomName: string, client: RoomClient) => void;

  /** Fired when a message is received from a client. */
  message: (client: RoomClient, data: unknown) => void;

  /** Fired when a new room is created (first client joins). */
  roomCreate: (roomName: string) => void;

  /** Fired when a room is destroyed (last client leaves). */
  roomDelete: (roomName: string) => void;

  /** Fired on internal errors (malformed frames, plugin throws, etc). */
  error: (error: Error, client?: RoomClient) => void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Configuration for `wsRooms(app, options)`.
 *
 * Most options have sensible defaults — a minimal setup only needs `path`.
 */
export interface WsRoomOptions {
  /**
   * WebSocket endpoint path registered via `app.ws()`.
   * @default '/ws'
   */
  path?: string;

  /**
   * Maximum number of rooms a single client can join simultaneously.
   * Prevents memory abuse from a single connection subscribing to
   * thousands of topics.
   *
   * Set to `Infinity` to disable the limit entirely.
   * @default 50
   */
  maxRoomsPerClient?: number;

  /**
   * Presence heartbeat interval in milliseconds. A periodic ping is
   * sent to all connected clients; non-responsive clients are evicted
   * after `idleTimeout` (handled by uWS natively).
   *
   * Set to `0` to disable presence heartbeats entirely.
   * @default 30000
   */
  presenceIntervalMs?: number;

  /**
   * Maximum WebSocket payload size in bytes.
   * @default 262144 (256 KB)
   */
  maxPayloadLength?: number;

  /**
   * Per-message compression mode (uWS constant).
   * @default uWS.SHARED_COMPRESSOR
   */
  compression?: number;

  /**
   * Idle timeout in seconds. uWS closes connections that don't send
   * any data (including pong frames) within this window.
   * @default 120
   */
  idleTimeout?: number;

  /**
   * Axiomify route-level plugins to run during the HTTP→WS upgrade.
   *
   * Use this for authentication, rate-limiting, fingerprinting, etc.
   * If any plugin calls `res.status(4xx).send(...)`, the upgrade is
   * refused and the WebSocket connection is never established.
   *
   * @example
   * ```ts
   * import { createAuthPlugin } from '@axiomify/auth';
   * wsRooms(app, {
   *   plugins: [createAuthPlugin({ secret: process.env.JWT_SECRET! })],
   * });
   * ```
   */
  plugins?: RouteMiddleware[];

  /**
   * Optional Zod schema for incoming message validation.
   *
   * If provided, every incoming text frame is parsed as JSON and
   * validated against this schema. Invalid messages are rejected with
   * a structured error response — the `onMessage` / `message` event
   * handler never sees them.
   */
  schema?: ZodTypeAny;

  /**
   * Optional authorization check to run before a client joins a room.
   * Return true to allow, false or throw to reject.
   */
  beforeJoin?: (client: WsClient, roomName: string) => boolean | Promise<boolean>;

  /**
   * Optional allowlist pattern for room names.
   * If beforeJoin is not registered, only rooms matching this pattern are allowed.
   * By default (no beforeJoin, no allowlist), all joins are denied.
   */
  allowlist?: RegExp;

  /**
   * Enable security sanitization (XSS, Prototype Pollution, Null Byte) on incoming messages.
   * Requires `@axiomify/security` to be installed.
   * @default true
   */
  sanitize?:
    | boolean
    | {
        xssProtection?: boolean;
        prototypePollutionProtection?: boolean;
        nullByteProtection?: boolean;
        maxDepth?: number;
      };

  /**
   * Called when a client connects (after successful upgrade).
   * Equivalent to listening for the `open` event on `app.ws()`.
   */
  onConnect?: (client: RoomClient) => void;

  /**
   * Called when a client disconnects (voluntary or timeout).
   * The client has already been removed from all rooms by this point.
   */
  onDisconnect?: (client: RoomClient, code: number, reason: string) => void;

  /**
   * Called on every validated incoming message.
   *
   * If the built-in wire protocol is used (actions: join/leave/message),
   * this fires AFTER the action has been processed. For custom protocols,
   * this is the only handler you need.
   */
  onMessage?: (client: RoomClient, data: unknown) => void;
}

// ---------------------------------------------------------------------------
// Wire protocol types (internal, but documented for client-side devs)
// ---------------------------------------------------------------------------

/** Client → Server action frame. */
export type ClientAction =
  | { action: 'join'; room: string }
  | { action: 'leave'; room: string }
  | { action: 'message'; room: string; data: unknown }
  | { action: 'presence'; room: string };

/** Server → Client event frame. */
export type ServerEvent =
  | { event: 'joined'; room: string }
  | { event: 'left'; room: string }
  | { event: 'message'; room: string; from: string; data: unknown }
  | {
      event: 'presence';
      room: string;
      clients: Array<{
        id: string;
        state: Record<string, any>;
        joinedAt: number;
      }>;
    }
  | { event: 'error'; message: string; code?: string };
