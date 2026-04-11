import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WsClient, WsManager } from '../src/index';

// Mock Node HTTP Server
const mockServer = { on: vi.fn() } as any;

describe('WsManager', () => {
  it('initializes and binds to the HTTP upgrade event', () => {
    new WsManager({ server: mockServer });
    expect(mockServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
  });

  it('manages room joins, leaves, and broadcasts', () => {
    const manager = new WsManager({ server: mockServer });

    // Create a mock WebSocket client (readyState 1 = OPEN)
    const mockClient = {
      id: 'client_1',
      rooms: new Set(),
      send: vi.fn(),
      readyState: 1,
    } as unknown as WsClient;

    // 1. Join
    manager.joinRoom(mockClient, 'room-a');
    expect(mockClient.rooms.has('room-a')).toBe(true);

    // 2. Broadcast
    manager.broadcastToRoom('room-a', 'test:event', { hello: 'world' });
    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'test:event', data: { hello: 'world' } }),
    );

    // 3. Leave
    manager.leaveRoom(mockClient, 'room-a');
    expect(mockClient.rooms.has('room-a')).toBe(false);

    // Ensure broadcasting to an empty room doesn't crash
    expect(() => manager.broadcastToRoom('room-a', 'test', {})).not.toThrow();
  });

  it('validates incoming events using Zod schemas', () => {
    const manager = new WsManager({ server: mockServer });

    const handler = vi.fn();
    manager.on('user:create', z.object({ name: z.string() }), handler);

    // Simulate an active client connection
    const mockWs = {
      id: 'client_1',
      rooms: new Set(),
      on: vi.fn(),
      send: vi.fn(),
    } as any;

    manager.wss.emit('connection', mockWs);

    // Extract the internal 'message' event listener the manager attached
    const messageHandler = mockWs.on.mock.calls.find(
      (call: any) => call[0] === 'message',
    )[1];

    // 1. Valid Payload: Should trigger handler
    const validPayload = Buffer.from(
      JSON.stringify({ event: 'user:create', data: { name: 'Alice' } }),
    );
    messageHandler(validPayload, false);

    expect(handler).toHaveBeenCalled();
    const handlerData = handler.mock.calls[0][1];
    expect(handlerData.name).toBe('Alice');

    // 2. Invalid Payload: Should be caught by Zod and return an error to the client
    const invalidPayload = Buffer.from(
      JSON.stringify({ event: 'user:create', data: { age: 30 } }),
    );
    messageHandler(invalidPayload, false);

    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('Validation failed'),
    );
  });

  it('cleans up rooms when a client disconnects', () => {
    const manager = new WsManager({ server: mockServer });
    const mockWs = { id: 'client_1', rooms: new Set(), on: vi.fn() } as any;

    manager.wss.emit('connection', mockWs);
    manager.joinRoom(mockWs, 'room-b');

    const closeHandler = mockWs.on.mock.calls.find(
      (call: any) => call[0] === 'close',
    )[1];
    closeHandler(); // Simulate disconnect

    expect(mockWs.rooms.has('room-b')).toBe(false);
  });
});
