import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useSecurity } from '../src';

describe('Security Package', () => {
  const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  });

  it('should block large payloads', async () => {
    const app = new Axiomify();
    useSecurity(app, { maxBodySize: 10 });

    const req: any = {
      headers: { 'content-length': '20' },
      method: 'POST',
      path: '/',
      state: {},
    };
    const res: any = makeRes();

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
    const res: any = makeRes();

    await (app as any).handle(req, res);
    expect(req.query.user).toBe('attacker');
  });

  it('should detect SQL injection', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      query: { id: "1 UNION SELECT * FROM users" },
      method: 'GET',
      path: '/',
      state: {},
    };
    const res: any = makeRes();

    await (app as any).handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should detect NoSQL injection operators', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      body: { username: { $ne: null } },
      method: 'POST',
      path: '/',
      state: {},
    };
    const res: any = makeRes();

    await (app as any).handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should block suspicious scanner user agents', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: { 'user-agent': 'sqlmap/1.8.3' },
      method: 'GET',
      path: '/',
      state: {},
    };
    const res: any = makeRes();

    await (app as any).handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should sanitize XSS and remove prototype pollution keys', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      body: {
        content: '<script>alert(1)</script>hello',
        __proto__: { polluted: true },
      },
      method: 'POST',
      path: '/',
      state: {},
    };
    const res: any = makeRes();

    await (app as any).handle(req, res);
    expect(req.body.content).not.toContain('<script>');
    expect(Object.prototype.hasOwnProperty.call(req.body, '__proto__')).toBe(false);
  });

  it('should strip null bytes from string input', async () => {
    const app = new Axiomify();
    useSecurity(app);

    const req: any = {
      headers: {},
      body: { value: 'abc\u0000def' },
      method: 'POST',
      path: '/',
      state: {},
    };
    const res: any = makeRes();

    await (app as any).handle(req, res);
    expect(req.body.value).toBe('abcdef');
  });
});
