import { describe, it, expect, vi } from 'vitest';
import { useSecurity } from '../src';
import { sanitizeInput, normalizeHpp } from '../src/utils/sanitizer';
import { detectNoSqlInjection, isSuspiciousUserAgent } from '../src/utils/detector';

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

  it('does NOT block SQL-like payloads (heuristic removed in 5.0; option gone in 6.0)', async () => {
    // The SQL injection regex heuristic was trivially bypassable AND
    // produced false positives on legitimate JSON. Removed in 5.0 (no-op),
    // option entirely deleted in 6.0. Setting it on the options object
    // is now just an excess property that TS will reject at compile-time.
    const hook = setup({});
    const req: any = {
      headers: {},
      query: { id: '1 UNION SELECT * FROM users' },
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

  it('NoSQL detector should ignore Dates/Buffers and handle deep/cyclic structures safely', async () => {
    const hook = setup({ noSqlInjectionProtection: true });

    // Ignore Dates/Buffers
    const reqDateBuffer: any = {
      headers: {},
      query: {},
      params: {},
      body: { date: new Date(), buffer: Buffer.from('hello') },
    };
    const res1 = makeRes();
    await hook(reqDateBuffer, res1);
    expect(res1.status).not.toHaveBeenCalledWith(403);

    // Deep recursion should be capped (no stack overflow, returns safely)
    let deep: any = { val: 'safe' };
    for (let i = 0; i < 70; i++) deep = { child: deep };
    const reqDeep: any = {
      headers: {},
      query: {},
      params: {},
      body: deep,
    };
    const res2 = makeRes();
    await hook(reqDeep, res2);
    expect(res2.status).not.toHaveBeenCalledWith(403);

    // Cyclic structures (which can happen internally) should be handled without throwing call stack size exceeded
    const cyclic: any = {};
    cyclic.self = cyclic;
    const reqCyclic: any = {
      headers: {},
      query: {},
      params: {},
      body: cyclic,
    };
    const res3 = makeRes();
    // Since cycle will exceed max depth, it will return false instead of blowing up the stack
    await expect(hook(reqCyclic, res3)).resolves.not.toThrow();
    expect(res3.status).not.toHaveBeenCalledWith(403);
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
    const res: any = {
      status: () => res,
      send: () => {},
      header: () => res,
      headersSent: false,
    };

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

describe('Security Utils Extra Coverage', () => {
  it('should handle Object.create(null) in isPlainObject and sanitize correctly', () => {
    const obj = Object.create(null);
    obj.foo = 'bar';
    obj.nested = Object.create(null);
    obj.nested.xss = '<script>alert(1)</script>';

    const sanitized: any = sanitizeInput(obj);
    expect(sanitized.foo).toBe('bar');
    expect(sanitized.nested.xss).toBe('');
  });

  it('should hit MAX_SANITIZE_ITERATIONS cap on 12 nested script tags without hanging', () => {
    const input = '<script>'.repeat(12) + 'alert(1)' + '</script>'.repeat(12);
    const sanitized = sanitizeInput(input);
    // Since cap is 10, some residual outer script tags will remain
    expect(typeof sanitized).toBe('string');
  });

  it('should return undefined if sanitizeInput exceeds max depth', () => {
    let deep: any = 'safe';
    for (let i = 0; i < 70; i++) {
      deep = { child: deep };
    }
    const sanitized: any = sanitizeInput(deep);
    // Navigate down to depth 65
    let curr = sanitized;
    for (let i = 0; i < 65; i++) {
      curr = curr.child;
    }
    expect(curr).toBeUndefined();
  });

  it('should detect NoSQL injection with custom patterns', () => {
    expect(detectNoSqlInjection({ key: 'test' }, [/\btest\b/])).toBe(true);
    expect(detectNoSqlInjection('hello', [/\bworld\b/])).toBe(false);
  });

  it('should detect suspicious user agents with default and custom patterns', () => {
    expect(isSuspiciousUserAgent(undefined)).toBe(false);
    expect(isSuspiciousUserAgent('normal-browser')).toBe(false);
    expect(isSuspiciousUserAgent('my-scanner', [/\bscanner\b/])).toBe(true);
  });

  it('should handle normalizeHpp edge cases', () => {
    expect(normalizeHpp(null)).toBeNull();
    expect(normalizeHpp('not-an-object')).toBe('not-an-object');
    expect(normalizeHpp({ a: [1, 2, 3], b: 'hello' })).toEqual({ a: 3, b: 'hello' });
  });
});
