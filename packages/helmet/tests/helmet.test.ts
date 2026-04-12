import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useHelmet } from '../src/index';

describe('Helmet Plugin', () => {
  it('sets default security headers', async () => {
    const app = new Axiomify();
    useHelmet(app);
    
    app.route({ method: 'GET', path: '/', handler: async (req, res) => res.status(200).send('ok') });
    
    const mockReq = { method: 'GET', path: '/', params: {}, headers: {}, id: 'req-1' } as any;
    const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis(), headersSent: false } as any;
    
    await app.handle(mockReq, mockRes);
    
    expect(mockRes.header).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(mockRes.header).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(mockRes.header).not.toHaveBeenCalledWith('Strict-Transport-Security', expect.any(String));
  });

  it('allows disabling specific headers', async () => {
    const app = new Axiomify();
    useHelmet(app, { xFrameOptions: false });
    
    app.route({ method: 'GET', path: '/', handler: async (req, res) => res.status(200).send('ok') });
    const mockReq = { method: 'GET', path: '/', params: {}, headers: {}, id: 'req-2' } as any;
    const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis(), headersSent: false } as any;
    
    await app.handle(mockReq, mockRes);
    expect(mockRes.header).not.toHaveBeenCalledWith('X-Frame-Options', expect.any(String));
  });

  it('sets HSTS when opted in', async () => {
    const app = new Axiomify();
    useHelmet(app, { hsts: true });
    
    app.route({ method: 'GET', path: '/', handler: async (req, res) => res.status(200).send('ok') });
    const mockReq = { method: 'GET', path: '/', params: {}, headers: {}, id: 'req-3' } as any;
    const mockRes = { status: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis(), headersSent: false } as any;
    
    await app.handle(mockReq, mockRes);
    expect(mockRes.header).toHaveBeenCalledWith('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  });
});
