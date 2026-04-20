import { Axiomify } from '@axiomify/core';
import EventEmitter from 'events';
import { describe, expect, it, vi } from 'vitest';
import { useWebSockets, WsManager } from '../src/index';

describe('WebSocket Plugin', () => {
  it('registers WS plugin with a mock server', () => {
    const app = new Axiomify();
    const mockServer = { on: vi.fn() };
    useWebSockets(app, { server: mockServer as any });
    expect(app.registeredRoutes).toBeDefined();
  });

  it('WsManager handles connections, messages, and limits', async () => {
    const manager = new WsManager({
      server: { on: vi.fn() },
      heartbeatIntervalMs: 10,
      maxMessageBytes: 10,
    } as any);

    const client = new EventEmitter() as any;
    client.send = vi.fn();
    client.close = vi.fn();
    client.terminate = vi.fn();
    client.ping = vi.fn();

    // Trigger internal connection logic
    (manager as any).wss.emit('connection', client, { url: '/ws' });

    // Test 4.7: WebSocket message size limit
    client.emit('message', Buffer.alloc(20));
    expect(client.close).toHaveBeenCalledWith(1009);

    // Test 4.6: WebSocket heartbeat pong
    client.emit('pong');

    // Test stats reporting
    const stats = manager.getStats();
    expect(stats).toHaveProperty('connectedClients');
  });
});
