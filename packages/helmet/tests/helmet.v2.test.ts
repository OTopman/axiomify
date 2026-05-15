import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useHelmet } from '../src';

describe('Helmet Package V2', () => {
  it('should set security headers by default', async () => {
    const app = new Axiomify();
    useHelmet(app);

    const req: any = { headers: {}, method: 'GET', path: '/', state: {} };
    const res: any = {
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req, res);

    expect(res.header).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
    expect(res.header).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(res.header).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      expect.stringContaining('max-age'),
    );
  });

  it('should remove sensitive headers', async () => {
    const app = new Axiomify();
    useHelmet(app, { removeHeaders: ['X-Powered-By', 'Custom-Header'] });

    const req: any = { headers: {}, method: 'GET', path: '/', state: {} };
    const res: any = {
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req, res);

    expect(res.removeHeader).toHaveBeenCalledWith('X-Powered-By');
    expect(res.removeHeader).toHaveBeenCalledWith('Custom-Header');
  });
});

describe('useHelmet — option overrides and string values', () => {
  it('uses string override for X-XSS-Protection when provided', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { useHelmet } = await import('../src/index');
    const app = new Axiomify();
    useHelmet(app, { xXssProtection: '1; mode=block' });
    const req: any = { headers: {}, method: 'GET', path: '/', state: {}, ip: '', id: 'r', params: {}, query: {}, body: undefined, url: '/' };
    const res: any = {
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    await (app as any).handle(req, res);
    expect(res.header).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
  });

  it('hsts object form with explicit maxAge / no-subdomains / preload', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { useHelmet } = await import('../src/index');
    const app = new Axiomify();
    useHelmet(app, {
      hsts: { maxAge: 60, includeSubDomains: false, preload: true },
    });
    const req: any = { headers: {}, method: 'GET', path: '/', state: {}, ip: '', id: 'r', params: {}, query: {}, body: undefined, url: '/' };
    const res: any = {
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    await (app as any).handle(req, res);
    const hstsCall = (res.header as any).mock.calls.find(
      (c: any[]) => c[0] === 'Strict-Transport-Security',
    );
    expect(hstsCall?.[1]).toBe('max-age=60; preload');
  });

  it('hsts object form using defaults for maxAge and includeSubDomains', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { useHelmet } = await import('../src/index');
    const app = new Axiomify();
    useHelmet(app, { hsts: {} });
    const req: any = { headers: {}, method: 'GET', path: '/', state: {}, ip: '', id: 'r', params: {}, query: {}, body: undefined, url: '/' };
    const res: any = {
      header: vi.fn().mockReturnThis(),
      removeHeader: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    await (app as any).handle(req, res);
    const hstsCall = (res.header as any).mock.calls.find(
      (c: any[]) => c[0] === 'Strict-Transport-Security',
    );
    expect(hstsCall?.[1]).toBe('max-age=15552000; includeSubDomains');
  });
});
