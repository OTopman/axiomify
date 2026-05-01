import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useMetrics } from '../src/index';

describe('Metrics Plugin', () => {
  it('protect returns 403 when false', async () => {
    const app = new Axiomify();
    useMetrics(app, { protect: () => false });
    const req = { method: 'GET', path: '/metrics', headers: {}, id: '1', params: {}, query: {}, body: {}, state: {}, ip: '127.0.0.1' } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), headersSent: false, header: vi.fn().mockReturnThis() } as any;
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when requireToken is set and header is missing', async () => {
    const app = new Axiomify();
    useMetrics(app, { requireToken: 'secret-token' });
    const req = { method: 'GET', path: '/metrics', headers: {}, id: '2', params: {}, query: {}, body: {}, state: {}, ip: '127.0.0.1' } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), headersSent: false, header: vi.fn().mockReturnThis() } as any;
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows request when requireToken header is correct', async () => {
    const app = new Axiomify();
    useMetrics(app, { requireToken: 'secret-token' });
    const req = { method: 'GET', path: '/metrics', headers: { 'x-metrics-token': 'secret-token' }, id: '5', params: {}, query: {}, body: {}, state: {}, ip: '127.0.0.1' } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), headersSent: false, header: vi.fn().mockReturnThis(), sendRaw: vi.fn() } as any;
    await app.handle(req, res);
    expect(res.sendRaw).toHaveBeenCalled();
  });

  it('returns 403 when allowlist is set but IP is not allowed', async () => {
    const app = new Axiomify();
    useMetrics(app, { allowlist: ['192.168.1.1'] });
    const req = { method: 'GET', path: '/metrics', headers: {}, id: '4', params: {}, query: {}, body: {}, state: {}, ip: '10.2.3.4' } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), headersSent: false, header: vi.fn().mockReturnThis(), sendRaw: vi.fn() } as any;
    await app.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.sendRaw).not.toHaveBeenCalled();
  });

  it('allows request when IP is in CIDR allowlist', async () => {
    const app = new Axiomify();
    useMetrics(app, { allowlist: ['10.0.0.0/8'] });
    const req = { method: 'GET', path: '/metrics', headers: {}, id: '3', params: {}, query: {}, body: {}, state: {}, ip: '10.2.3.4' } as any;
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), headersSent: false, header: vi.fn().mockReturnThis(), sendRaw: vi.fn() } as any;
    await app.handle(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.sendRaw).toHaveBeenCalled();
  });
});
