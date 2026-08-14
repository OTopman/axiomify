import { Axiomify, setCookie } from '@axiomify/core';
import { describe, expect, it } from 'vitest';
import { createTestClient, parseSetCookie } from '../src/index';

describe('request cookies', () => {
  it('serialises the cookies option into the Cookie header', async () => {
    const app = new Axiomify();
    let seen: Record<string, string> = {};
    let header: unknown;
    app.route({
      method: 'GET',
      path: '/whoami',
      handler: async (req, res) => {
        seen = { ...req.cookies };
        header = req.headers['cookie'];
        res.send(null);
      },
    });

    await createTestClient(app).get('/whoami', {
      cookies: { sid: 'abc123', theme: 'dark mode' },
    });
    expect(header).toBe('sid=abc123; theme=dark%20mode');
    // Round-trips through core's parseCookieHeader (URI-decoded)
    expect(seen).toEqual({ sid: 'abc123', theme: 'dark mode' });
  });

  it('appends option cookies to an explicit Cookie header', async () => {
    const app = new Axiomify();
    let header: unknown;
    app.route({
      method: 'GET',
      path: '/c',
      handler: async (req, res) => {
        header = req.headers['cookie'];
        res.send(null);
      },
    });

    await createTestClient(app).get('/c', {
      headers: { Cookie: 'existing=1' },
      cookies: { extra: '2' },
    });
    expect(header).toBe('existing=1; extra=2');
  });

  it('rejects invalid cookie names in the cookies option', async () => {
    const app = new Axiomify();
    await expect(
      createTestClient(app).get('/x', { cookies: { 'bad name': 'v' } }),
    ).rejects.toThrow(/Invalid cookie name/);
  });
});

describe('response cookies', () => {
  it('captures multiple Set-Cookie lines via res.cookie()', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/login',
      handler: async (_req, res) => {
        res.cookie!('sid', 'top secret', {
          maxAge: 3600,
          sameSite: 'strict',
          secure: true,
        }).cookie!('pref', 'blue', { httpOnly: false });
        res.send({ ok: true });
      },
    });

    const res = await createTestClient(app).get('/login');
    const setCookieHeader = res.headers['set-cookie'];
    expect(Array.isArray(setCookieHeader)).toBe(true);
    expect(setCookieHeader).toHaveLength(2);

    expect(res.cookies).toHaveLength(2);
    const sid = res.cookies.find((c) => c.name === 'sid')!;
    expect(sid.value).toBe('top secret'); // URI-decoded back
    expect(sid.maxAge).toBe(3600);
    expect(sid.httpOnly).toBe(true);
    expect(sid.secure).toBe(true);
    expect(sid.sameSite).toBe('strict');
    expect(sid.path).toBe('/');

    const pref = res.cookies.find((c) => c.name === 'pref')!;
    expect(pref.httpOnly).toBe(false);
    expect(pref.sameSite).toBe('lax');
  });

  it('clearCookie() emits an expired Set-Cookie line', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/logout',
      handler: async (_req, res) => {
        res.clearCookie!('sid', { path: '/app' });
        res.send(null);
      },
    });

    const res = await createTestClient(app).post('/logout');
    expect(res.cookies).toHaveLength(1);
    const [cleared] = res.cookies;
    expect(cleared.name).toBe('sid');
    expect(cleared.value).toBe('');
    expect(cleared.maxAge).toBe(0);
    expect(cleared.expires?.getTime()).toBe(0);
    expect(cleared.path).toBe('/app');
  });

  it('works through core setCookie() (adapter-agnostic helper)', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/helper',
      handler: async (_req, res) => {
        setCookie(res, 'via', 'helper');
        res.send(null);
      },
    });

    const res = await createTestClient(app).get('/helper');
    expect(res.cookies[0]).toMatchObject({ name: 'via', value: 'helper' });
  });

  it('merges a directly-set Set-Cookie header with cookie() lines', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/mixed',
      handler: async (_req, res) => {
        res.header('Set-Cookie', 'legacy=1');
        res.cookie!('modern', '2');
        res.send(null);
      },
    });

    const res = await createTestClient(app).get('/mixed');
    expect(res.headers['set-cookie']).toEqual([
      'legacy=1',
      'modern=2; Path=/; HttpOnly; SameSite=Lax',
    ]);
    expect(res.cookies.map((c) => c.name)).toEqual(['legacy', 'modern']);
  });

  it('propagates serializeCookie validation errors (invalid name → 500)', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/badcookie',
      handler: async (_req, res) => {
        res.cookie!('bad name', 'v');
        res.send(null);
      },
    });

    const res = await createTestClient(app).get('/badcookie');
    expect(res.statusCode).toBe(500);
    expect(res.json<{ message: string }>().message).toMatch(
      /Invalid cookie name/,
    );
  });
});

describe('parseSetCookie', () => {
  it('parses the full attribute set', () => {
    const parsed = parseSetCookie(
      'sid=abc; Domain=example.com; Path=/app; ' +
        'Expires=Wed, 01 Jan 2025 00:00:00 GMT; Max-Age=60; HttpOnly; ' +
        'Secure; SameSite=None; Partitioned; Priority=High',
    );
    expect(parsed).toMatchObject({
      name: 'sid',
      value: 'abc',
      domain: 'example.com',
      path: '/app',
      maxAge: 60,
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      priority: 'high',
    });
    expect(parsed.expires?.toUTCString()).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
  });

  it('unquotes quoted values and URI-decodes', () => {
    expect(parseSetCookie('a="hello%20world"').value).toBe('hello world');
  });

  it('keeps malformed percent-encodings verbatim', () => {
    expect(parseSetCookie('a=100%').value).toBe('100%');
  });

  it('drops malformed Expires and Max-Age values', () => {
    const parsed = parseSetCookie('a=1; Expires=garbage; Max-Age=NaN');
    expect(parsed.expires).toBeUndefined();
    expect(parsed.maxAge).toBeUndefined();
  });

  it('ignores unknown attributes and invalid enum values', () => {
    const parsed = parseSetCookie(
      'a=1; X-Unknown=zzz; SameSite=weird; Priority=urgent; HttpOnly',
    );
    expect(parsed.sameSite).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
    expect(parsed.httpOnly).toBe(true);
  });

  it('handles a bare name with no value or equals sign', () => {
    expect(parseSetCookie('flag')).toMatchObject({ name: 'flag', value: '' });
  });
});
