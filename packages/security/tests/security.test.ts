import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useSecurity } from '../src';

describe('Security Package', () => {
  it('should block large payloads', async () => {
    const app = new Axiomify();
    useSecurity(app, { maxBodySize: 10 });

    const req: any = {
      headers: { 'content-length': '20' },
      method: 'POST',
      path: '/',
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('should prevent parameter pollution', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      query: { user: ['admin', 'attacker'] },
      method: 'GET',
      path: '/',
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    // Mock handle to run hooks
    await (app as any).handle(req, res);
    expect(req.query.user).toBe('attacker');
  });

  it('should detect SQL injection', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      query: { id: "1' OR '1'='1" },
      method: 'GET',
      path: '/',
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should sanitize XSS', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      body: { content: '<script>alert(1)</script>hello' },
      method: 'POST',
      path: '/',
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await (app as any).handle(req, res);
    expect(req.body.content).not.toContain('<script>');
    expect(req.body.content).toContain('hello');
  });
});
