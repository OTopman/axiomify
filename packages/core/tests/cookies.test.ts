import { describe, expect, it } from 'vitest';
import {
  clearCookie,
  getCookies,
  parseCookieHeader,
  serializeCookie,
  setCookie,
  signCookieValue,
  unsignCookieValue,
} from '../src/cookies';
import type { AxiomifyRequest, AxiomifyResponse } from '../src/types';

describe('parseCookieHeader', () => {
  it('parses a simple cookie pair', () => {
    expect(parseCookieHeader('a=1')).toEqual({ a: '1' });
  });

  it('parses multiple pairs with whitespace', () => {
    expect(parseCookieHeader('a=1; b=2;c=3')).toEqual({
      a: '1',
      b: '2',
      c: '3',
    });
  });

  it('keeps the first occurrence on duplicates (shadowing defence)', () => {
    expect(parseCookieHeader('sid=real; sid=forged')).toEqual({ sid: 'real' });
  });

  it('URI-decodes encoded values', () => {
    expect(parseCookieHeader('name=hello%20world')).toEqual({
      name: 'hello world',
    });
  });

  it('keeps malformed percent-encodings verbatim', () => {
    expect(parseCookieHeader('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
  });

  it('unquotes quoted values', () => {
    expect(parseCookieHeader('a="quoted value"')).toEqual({
      a: 'quoted value',
    });
  });

  it('ignores segments without an equals sign', () => {
    expect(parseCookieHeader('junk; a=1')).toEqual({ a: '1' });
  });

  it('returns an empty record for an empty header', () => {
    expect(parseCookieHeader('')).toEqual({});
  });

  it('returns a null-prototype object (pollution defence)', () => {
    const parsed = parseCookieHeader('__proto__=x');
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(({} as any).x).toBeUndefined();
  });
});

describe('serializeCookie', () => {
  it('serialises with secure-by-default attributes', () => {
    expect(serializeCookie('sid', 'abc')).toBe(
      'sid=abc; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('emits all supported attributes', () => {
    const out = serializeCookie('sid', 'abc', {
      domain: 'example.com',
      path: '/app',
      expires: new Date('2030-01-01T00:00:00Z'),
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      partitioned: true,
      priority: 'high',
    });
    expect(out).toBe(
      'sid=abc; Domain=example.com; Path=/app; ' +
        'Expires=Tue, 01 Jan 2030 00:00:00 GMT; Max-Age=3600; HttpOnly; ' +
        'Secure; SameSite=Strict; Partitioned; Priority=High',
    );
  });

  it('URI-encodes values outside the RFC 6265 set', () => {
    expect(serializeCookie('a', 'hello world;')).toContain(
      'a=hello%20world%3B',
    );
  });

  it('allows opting out of HttpOnly', () => {
    expect(serializeCookie('a', '1', { httpOnly: false })).not.toContain(
      'HttpOnly',
    );
  });

  it('auto-sets Secure for SameSite=None', () => {
    expect(serializeCookie('a', '1', { sameSite: 'none' })).toContain(
      '; Secure; SameSite=None',
    );
  });

  it('throws on SameSite=None with secure explicitly false', () => {
    expect(() =>
      serializeCookie('a', '1', { sameSite: 'none', secure: false }),
    ).toThrow(/SameSite=None/);
  });

  it('throws on invalid cookie names', () => {
    expect(() => serializeCookie('bad name', '1')).toThrow(/Invalid cookie/);
    expect(() => serializeCookie('bad;name', '1')).toThrow(/Invalid cookie/);
    expect(() => serializeCookie('', '1')).toThrow(/Invalid cookie/);
  });

  it('throws on attribute injection attempts', () => {
    expect(() =>
      serializeCookie('a', '1', { path: '/x;\r\nSet-Cookie: pwn=1' }),
    ).toThrow(/illegal characters/);
    expect(() =>
      serializeCookie('a', '1', { domain: 'x\r\n.evil.com' }),
    ).toThrow(/illegal characters/);
  });

  it('throws on invalid expires / non-finite maxAge', () => {
    expect(() =>
      serializeCookie('a', '1', { expires: new Date('nope') }),
    ).toThrow(/invalid Date/);
    expect(() => serializeCookie('a', '1', { maxAge: Infinity })).toThrow(
      /finite/,
    );
  });

  it('throws on Partitioned without Secure', () => {
    expect(() => serializeCookie('a', '1', { partitioned: true })).toThrow(
      /Partitioned/,
    );
  });

  it('floors fractional maxAge', () => {
    expect(serializeCookie('a', '1', { maxAge: 12.9 })).toContain('Max-Age=12');
  });
});

describe('cookie signing', () => {
  it('round-trips a signed value', () => {
    const signed = signCookieValue('user42', 'topsecret');
    expect(signed.startsWith('s:user42.')).toBe(true);
    expect(unsignCookieValue(signed, 'topsecret')).toEqual({
      valid: true,
      value: 'user42',
    });
  });

  it('rejects tampered values', () => {
    const signed = signCookieValue('user42', 'topsecret');
    const tampered = signed.replace('user42', 'user43');
    expect(unsignCookieValue(tampered, 'topsecret').valid).toBe(false);
  });

  it('rejects wrong secrets and unsigned input', () => {
    const signed = signCookieValue('v', 'right');
    expect(unsignCookieValue(signed, 'wrong').valid).toBe(false);
    expect(unsignCookieValue('v', 'right').valid).toBe(false);
    expect(unsignCookieValue('s:v', 'right').valid).toBe(false);
  });

  it('supports secret rotation via an array of secrets', () => {
    const signed = signCookieValue('v', 'old-secret');
    expect(unsignCookieValue(signed, ['new-secret', 'old-secret'])).toEqual({
      valid: true,
      value: 'v',
    });
  });

  it('handles values containing dots', () => {
    const signed = signCookieValue('a.b.c', 'k');
    expect(unsignCookieValue(signed, 'k')).toEqual({
      valid: true,
      value: 'a.b.c',
    });
  });

  it('throws when signing with an empty secret', () => {
    expect(() => signCookieValue('v', '')).toThrow(/secret/);
  });

  it('round-trips a signed empty-string value', () => {
    // Regression: signCookieValue('', secret) produces "s:." + mac, placing
    // the separator dot at index 2. unsignCookieValue must accept this as a
    // well-formed empty-value signature, not reject it as malformed.
    const signed = signCookieValue('', 'topsecret');
    expect(signed.startsWith('s:.')).toBe(true);
    expect(unsignCookieValue(signed, 'topsecret')).toEqual({
      valid: true,
      value: '',
    });
  });

  it('rejects a string with no separator dot at all', () => {
    expect(unsignCookieValue('s:novaluenomac', 'k').valid).toBe(false);
  });
});

function mockRequest(cookieHeader?: string): AxiomifyRequest {
  return {
    id: '1',
    method: 'GET',
    url: '/',
    path: '/',
    ip: '',
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    body: null,
    query: {},
    params: {},
    state: {} as any,
    raw: null,
    stream: null as any,
  };
}

function mockResponse(withCookieMethods = false): AxiomifyResponse & {
  headers: Record<string, string>;
  cookieCalls: Array<[string, string, unknown]>;
} {
  const headers: Record<string, string> = {};
  const cookieCalls: Array<[string, string, unknown]> = [];
  const res: any = {
    headers,
    cookieCalls,
    statusCode: 200,
    headersSent: false,
    raw: null,
    capabilities: { sse: false, streaming: false },
    status: () => res,
    header: (k: string, v: string) => {
      headers[k] = v;
      return res;
    },
    getHeader: (k: string) => headers[k],
    removeHeader: (k: string) => {
      delete headers[k];
      return res;
    },
    send: () => {},
    sendRaw: () => {},
    stream: () => {},
  };
  if (withCookieMethods) {
    res.cookie = (n: string, v: string, o: unknown) => {
      cookieCalls.push([n, v, o]);
      return res;
    };
    res.clearCookie = (n: string, o: unknown) => {
      cookieCalls.push([n, '', o]);
      return res;
    };
  }
  return res;
}

describe('getCookies', () => {
  it('parses and memoises per request object', () => {
    const req = mockRequest('a=1; b=2');
    const first = getCookies(req);
    expect(first).toEqual({ a: '1', b: '2' });
    expect(getCookies(req)).toBe(first);
  });

  it('handles a missing Cookie header', () => {
    expect(getCookies(mockRequest())).toEqual({});
  });

  it('takes the first value when the header arrives as an array', () => {
    const req = mockRequest();
    (req.headers as any).cookie = ['a=1', 'b=2'];
    expect(getCookies(req)).toEqual({ a: '1' });
  });
});

describe('setCookie / clearCookie helpers', () => {
  it('prefers the adapter res.cookie() implementation', () => {
    const res = mockResponse(true);
    setCookie(res, 'sid', 'v', { maxAge: 5 });
    expect(res.cookieCalls).toEqual([['sid', 'v', { maxAge: 5 }]]);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('falls back to a single Set-Cookie header', () => {
    const res = mockResponse(false);
    setCookie(res, 'sid', 'v');
    expect(res.headers['Set-Cookie']).toBe(
      'sid=v; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('throws instead of silently overwriting in fallback mode', () => {
    const res = mockResponse(false);
    setCookie(res, 'a', '1');
    expect(() => setCookie(res, 'b', '2')).toThrow(/does not implement/);
  });

  it('clearCookie emits an expired cookie', () => {
    const res = mockResponse(false);
    clearCookie(res, 'sid', { path: '/app' });
    expect(res.headers['Set-Cookie']).toContain('sid=');
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(res.headers['Set-Cookie']).toContain('Path=/app');
    expect(res.headers['Set-Cookie']).toContain(
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
  });

  it('clearCookie delegates to the adapter implementation when present', () => {
    const res = mockResponse(true);
    clearCookie(res, 'sid');
    expect(res.cookieCalls).toEqual([['sid', '', undefined]]);
  });

  it('skips empty secrets in secret array when unsigning', () => {
    const signed = signCookieValue('val', 'secret_b');
    const res = unsignCookieValue(signed, ['', 'secret_b']);
    expect(res.valid).toBe(true);
    expect(res.value).toBe('val');
  });
});
