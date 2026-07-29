/**
 * @axiomify/ws — Room class.
 *
 * A `Room` is a thin, ergonomic wrapper around a uWebSockets.js topic.
 * It does NOT store messages or history — it is a live pub/sub namespace.
 * uWS handles the actual fan-out in C++; this class tracks membership
 * and exposes a developer-friendly API.
 *
 * ## Performance
 *
 * `broadcast()` calls `wsClient.publish(topic, ...)` which fans
 * out to all subscribers in O(1) kernel time — NOT a JavaScript
 * `for...of` loop. A room with 100,000 members broadcasts as fast as
 * a room with 1.
 */
import type { RoomClient } from './types';
import { wsClientMap } from './client-map';

/** Metadata stored per-client inside a Room. */
export interface RoomMember {
  client: RoomClient;
  joinedAt: number;
}

export class Room {
  /** The room name (also the uWS topic name). */
  public readonly name: string;

  /** Timestamp (ms) when this room was created. */
  public readonly createdAt: number;

  /** Internal membership map: clientId → RoomMember. */
  private readonly _members = new Map<string, RoomMember>();

  /**
   * @internal Cross-process forwarding hook, set by the RoomManager when a
   * `WsBroker` is configured. Invoked by the PUBLIC broadcast methods only —
   * the `_localBroadcast()` path used for messages arriving FROM the broker
   * never calls it, which is what prevents echo loops.
   */
  _forward?: (payload: string | Buffer, isBinary?: boolean) => void;

  constructor(name: string) {
    this.name = name;
    this.createdAt = Date.now();
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  /** Number of clients currently in this room. */
  get size(): number {
    return this._members.size;
  }

  /** Whether a specific client is in this room. */
  has(clientId: string): boolean {
    return this._members.has(clientId);
  }

  /** Iterate over all members. */
  get members(): IterableIterator<RoomMember> {
    return this._members.values();
  }

  /** Get all client IDs in the room. */
  get clientIds(): string[] {
    return Array.from(this._members.keys());
  }

  // -------------------------------------------------------------------------
  // Internal membership management (called by RoomManager)
  // -------------------------------------------------------------------------

  /** @internal Add a client to this room. */
  _addMember(client: RoomClient): void {
    this._members.set(client.id, {
      client,
      joinedAt: Date.now(),
    });
  }

  /** @internal Remove a client from this room. Returns true if the room is now empty. */
  _removeMember(clientId: string): boolean {
    this._members.delete(clientId);
    return this._members.size === 0;
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  /**
   * Broadcast a message to ALL clients in this room.
   *
   * Uses the first available member's `WsClient.publish()` which delegates
   * to uWS's native topic publish — O(1) regardless of room size.
   *
   * @param data — String, Buffer, or object (auto-JSON-serialised).
   * @param isBinary — Send as binary frame. Default `false`.
   */
  broadcast(data: string | Buffer | object, isBinary?: boolean): void {
    const payload =
      typeof data === 'string' || Buffer.isBuffer(data)
        ? data
        : JSON.stringify(data);

    this._localBroadcast(payload, isBinary);

    // Forward to the cross-process broker (if configured). Messages that
    // ARRIVE from the broker are delivered via _localBroadcast() directly,
    // so they never re-enter this hook — no echo loops.
    this._forward?.(payload, isBinary);
  }

  /**
   * @internal Deliver a payload to all LOCAL members of this room via the
   * native uWS topic publish. Does NOT forward to the broker — this is the
   * re-entry point for messages received from other nodes.
   */
  _localBroadcast(payload: string | Buffer, isBinary?: boolean): void {
    // Find any member to use for publishing.
    const firstMember = this._members.values().next();
    if (firstMember.done) return; // empty room

    const client = firstMember.value.client;
    const wsClient = wsClientMap.get(client);
    if (wsClient) {
      // Native O(1) publish to all other room members
      wsClient.publish(this.name, payload, isBinary);
      // Send to the publisher client itself since native publish excludes it
      client.send(payload, isBinary);
    } else {
      // Fallback: loop individually
      for (const member of this._members.values()) {
        member.client.send(payload, isBinary);
      }
    }
  }

  /**
   * Broadcast to all room members EXCEPT the specified client.
   *
   * @param excludeClientId — Client ID to exclude from the broadcast.
   * @param data — String, Buffer, or object.
   * @param isBinary — Send as binary frame. Default `false`.
   */
  broadcastExcept(
    excludeClientId: string,
    data: string | Buffer | object,
    isBinary?: boolean,
  ): void {
    const payload =
      typeof data === 'string' || Buffer.isBuffer(data)
        ? data
        : JSON.stringify(data);

    const excludedMember = this._members.get(excludeClientId);
    const client = excludedMember?.client;
    const wsClient = client ? wsClientMap.get(client) : undefined;
    if (wsClient) {
      // Native O(1) publish excludes the publisher automatically
      wsClient.publish(this.name, payload, isBinary);
    } else {
      // Fallback: loop individually
      for (const [clientId, member] of this._members) {
        if (clientId === excludeClientId) continue;
        member.client.send(payload, isBinary);
      }
    }

    // Forward to the cross-process broker (if configured). The excluded
    // client is by definition connected to THIS node, so remote nodes
    // deliver to all of their members — exclusion stays purely local.
    this._forward?.(payload, isBinary);
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  /**
   * Returns presence information for all clients in this room.
   *
   * Useful for "who's online" features. The `state` object comes from
   * the client's upgrade handshake — typically contains `user` data
   * set by the auth plugin.
   */
  getPresence(): Array<{
    id: string;
    state: Record<string, any>;
    joinedAt: number;
  }> {
    const sanitizeState = (val: any): any => {
      if (val === null || typeof val !== 'object') {
        return val;
      }
      if (Array.isArray(val)) {
        return val.map(sanitizeState);
      }
      const clean: Record<string, any> = {};
      for (const key of Object.keys(val)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('token') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password') ||
          lowerKey.includes('cookie') ||
          lowerKey.includes('session') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('jti') ||
          lowerKey === 'iat' ||
          lowerKey === 'exp' ||
          lowerKey === 'nbf'
        ) {
          continue;
        }
        clean[key] = sanitizeState(val[key]);
      }
      return clean;
    };

    const result: Array<{
      id: string;
      state: Record<string, any>;
      joinedAt: number;
    }> = [];
    for (const member of this._members.values()) {
      result.push({
        id: member.client.id,
        state: sanitizeState(member.client.state),
        joinedAt: member.joinedAt,
      });
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  /**
   * Force-remove a client from this room and optionally disconnect them.
   *
   * @param clientId — The client to kick.
   * @param reason — Optional human-readable reason sent to the client.
   * @param disconnect — Also disconnect the client entirely. Default `false`.
   */
  kick(clientId: string, reason?: string, disconnect?: boolean): boolean {
    const member = this._members.get(clientId);
    if (!member) return false;

    // Notify the client before removing them.
    member.client.send({
      event: 'kicked' as const,
      room: this.name,
      reason: reason ?? 'Kicked from room',
    });

    member.client.leave(this.name);

    if (disconnect) {
      member.client.disconnect(4000, reason ?? 'Kicked');
    }

    return true;
  }
}
