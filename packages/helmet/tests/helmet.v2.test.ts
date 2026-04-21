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
    
    expect(res.header).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.header).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(res.header).toHaveBeenCalledWith('Strict-Transport-Security', expect.stringContaining('max-age'));
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
