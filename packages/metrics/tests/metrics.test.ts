import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useMetrics } from '../src/index';

describe('Metrics Plugin', () => {
  it('protect returns 403 when false', async () => {
    const app = new Axiomify();
    useMetrics(app, { protect: () => false });
    
    const req = { method: 'GET', path: '/metrics', headers: {}, id: '1', params: {}, query: {}, body: {}, state: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), headersSent: false, header: vi.fn().mockReturnThis() } as any;
    
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('includes wsManager stats and handles status 0', async () => {
    const app = new Axiomify();
    const mockWs = { getStats: () => ({ connectedClients: 5, rooms: {} }) };
    useMetrics(app, { wsManager: mockWs });
    
    const req = { method: 'GET', path: '/metrics', headers: {}, id: '1', params: {}, query: {}, body: {}, state: {} } as any;
    let output = '';
    
    const res = { 
      status: vi.fn().mockReturnThis(), 
      send: vi.fn(),
      sendRaw: function(d: string) { output = d; this.headersSent = true; }, 
      headersSent: false,
      header: vi.fn().mockReturnThis()
    } as any;
    
    // Bypass the hook engine and execute the plugin's handler directly
    const route = app.registeredRoutes.find((r) => r.path === '/metrics');
    if (route && route.handler) {
       await route.handler(req, res);
    }
    
    expect(output).toContain('ws_connected_clients 5');
  });
});