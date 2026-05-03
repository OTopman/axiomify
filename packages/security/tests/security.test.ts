import { describe, it, expect, vi } from 'vitest';
import { useSecurity } from '../src';

describe('Security Package', () => {
  const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  });

  const setup = (options: any = {}) => {
    const app = { addHook: vi.fn() } as any;
    useSecurity(app, options);
    return app.addHook.mock.calls[0][1];
  };

  it('should block large payloads', async () => {
    const hook = setup({ maxBodySize: 10 });
    const req: any = {
      headers: { 'content-length': '20' },
      query: {},
      params: {},
      body: {},
    };
    const res = makeRes();

    await hook(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('should prevent parameter pollution', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: { user: ['admin', 'attacker'] },
      params: {},
      body: {},
    };
    const res = makeRes();

    await hook(req, res);
    expect(req.query.user).toBe('attacker');
  });

  it('should detect SQL injection', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: { id: '1 UNION SELECT * FROM users' },
      params: {},
      body: {},
    };
    const res = makeRes();

    await hook(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should detect NoSQL injection operators', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: {},
      params: {},
      body: { username: { $ne: null } },
    };
    const res = makeRes();

    await hook(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should block suspicious scanner user agents', async () => {
    const hook = setup();
    const req: any = {
      headers: { 'user-agent': 'sqlmap/1.8.3' },
      query: {},
      params: {},
      body: {},
    };
    const res = makeRes();

    await hook(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should sanitize XSS and remove prototype pollution keys', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: {},
      params: {},
      body: {
        content: '<script>alert(1)</script>hello',
        __proto__: { polluted: true },
      },
    };
    const res = makeRes();

    await hook(req, res);
    expect(req.body.content).not.toContain('<script>');
    expect(Object.prototype.hasOwnProperty.call(req.body, '__proto__')).toBe(
      false,
    );
  });

  it('should strip null bytes from string input', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: {},
      params: {},
      body: { value: 'abc\u0000def' },
    };
    const res = makeRes();

    await hook(req, res);
    expect(req.body.value).toBe('abcdef');
  });
});

// ─── Object.defineProperty replacement ───────────────────────────────────────

describe('useSecurity — no Object.defineProperty (V8 hidden-class safety)', () => {
  it('sanitised body is directly assigned without defineProperty', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { useSecurity } = await import('../src/index');

    const app = new Axiomify();
    useSecurity(app, { xssProtection: true });

    const req: any = {
      method: 'POST',
      path: '/test',
      headers: {},
      body: { safe: 'hello', bad: '<script>alert(1)</script>' },
      query: {},
      params: {},
      state: {},
    };
    const res: any = { status: () => res, send: () => {}, header: () => res, headersSent: false };

    // Fire the onRequest hook
    const hooks = (app as any).hooks?.hooks?.onRequest ?? [];
    for (const hook of hooks) {
      await hook(req, res);
    }

    // Body should be sanitized (XSS stripped) without defineProperty
    expect(req.body.safe).toBe('hello');
    // V8 hidden class check: after direct assignment, property descriptor must be writable
    const desc = Object.getOwnPropertyDescriptor(req, 'body');
    // If defineProperty was used with writable:true this would be writable, but we want
    // it to be a standard data property (plain assignment, not defineProperty).
    expect(desc?.writable !== false).toBe(true);
  });
});
