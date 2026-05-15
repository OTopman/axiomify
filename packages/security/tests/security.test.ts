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

  it('should detect SQL injection when explicitly enabled', async () => {
    // Heuristic SQL injection detection is OFF by default — opt-in only.
    const hook = setup({ sqlInjectionProtection: true });
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

  it('does NOT block SQL-like payloads by default (heuristic is opt-in)', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: { description: 'union select committee members from list' },
      params: {},
      body: {},
    };
    const res = makeRes();
    await hook(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('should detect NoSQL injection operators when explicitly enabled', async () => {
    const hook = setup({ noSqlInjectionProtection: true });
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

  it('does NOT block NoSQL-like payloads by default (heuristic is opt-in)', async () => {
    const hook = setup();
    const req: any = {
      headers: {},
      query: {},
      params: {},
      body: { username: { $ne: null } },
    };
    const res = makeRes();
    await hook(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
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
  it('uses plain assignment (not Object.defineProperty) when patching req.body', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { useSecurity } = await import('../src/index');

    // Spy on defineProperty BEFORE constructing the security plugin so any
    // accidental future call is recorded.
    const spy = vi.spyOn(Object, 'defineProperty');

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

    const before = spy.mock.calls.length;
    const hooks = (app as any).hooks?.hooks?.onRequest ?? [];
    for (const hook of hooks) {
      await hook(req, res);
    }
    const calledDuringHook = spy.mock.calls.slice(before);
    spy.mockRestore();

    // No defineProperty call should target req.body / req.query / req.params.
    const patchTargets = calledDuringHook
      .filter(([target]) => target === req)
      .map(([, key]) => key);
    expect(patchTargets).toEqual([]);

    // XSS still sanitised, descriptor remains a plain data property.
    expect(req.body.safe).toBe('hello');
    expect(req.body.bad).not.toContain('<script>');
  });
});
