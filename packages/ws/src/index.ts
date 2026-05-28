/**
 * @axiomify/ws — Native pub/sub room utility.
 *
 * ⚠️  This is NOT a wrapper for the `ws` npm package.
 *
 * This package provides a high-level rooms, presence, and pub/sub
 * abstraction built on uWebSockets.js O(1) topic broadcast. It works
 * exclusively with `@axiomify/native` — there is no generic WebSocket
 * fallback.
 *
 * @example
 * ```ts
 * import { Axiomify } from '@axiomify/core';
 * import { NativeAdapter } from '@axiomify/native';
 * import { wsRooms } from '@axiomify/ws';
 *
 * const app = new Axiomify();
 *
 * const rooms = wsRooms(app, {
 *   path: '/chat',
 *   onConnect(client) {
 *     client.join('lobby');
 *   },
 * });
 *
 * const adapter = new NativeAdapter(app, { port: 3000 });
 * adapter.listen();
 * ```
 *
 * @packageDocumentation
 */

export { wsRooms, RoomManager } from './room-manager';
export { Room } from './room';
export type {
  RoomClient,
  RoomEvents,
  WsRoomOptions,
  ClientAction,
  ServerEvent,
} from './types';
