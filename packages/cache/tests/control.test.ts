import { describe, expect, it } from 'vitest';
import { buildCacheControl, cacheControl, noCache } from '../src/control';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    header(k: string, v: string) {
      headers[k] = v;
      return this;
    },
    getHeader(k: string) {
      return headers[k];
    },
  } as any;
}

describe('buildCacheControl', () => {
  it.each([
    [{ maxAge: 60 }, 'max-age=60'],
    [{ sMaxage: 120 }, 's-maxage=120'],
    [{ scope: 'public' as const, maxAge: 60 }, 'public, max-age=60'],
    [{ scope: 'private' as const }, 'private'],
    [{ maxAge: 0, mustRevalidate: true }, 'max-age=0, must-revalidate'],
    [
      { scope: 'public' as const, maxAge: 31536000, immutable: true },
      'public, max-age=31536000, immutable',
    ],
    [
      { maxAge: 30, staleWhileRevalidate: 60 },
      'max-age=30, stale-while-revalidate=60',
    ],
    [
      {
        scope: 'public' as const,
        maxAge: 10,
        sMaxage: 60,
        mustRevalidate: true,
        immutable: true,
        staleWhileRevalidate: 5,
      },
      'public, max-age=10, s-maxage=60, must-revalidate, immutable, stale-while-revalidate=5',
    ],
    [{ noStore: true }, 'no-store'],
  ])('builds %j → %s', (options, expected) => {
    expect(buildCacheControl(options as any)).toBe(expected);
  });

  it('rejects an empty directive set', () => {
    expect(() => buildCacheControl({})).toThrow(/at least one directive/);
  });

  it('rejects noStore combined with other directives', () => {
    expect(() => buildCacheControl({ noStore: true, maxAge: 5 })).toThrow(
      /cannot be combined/,
    );
  });

  it('allows noStore alongside explicitly-undefined directives', () => {
    expect(buildCacheControl({ noStore: true, maxAge: undefined })).toBe(
      'no-store',
    );
  });
});

describe('cacheControl middleware', () => {
  it('sets the header', async () => {
    const res = makeRes();
    await cacheControl({ scope: 'public', maxAge: 60 })({} as any, res);
    expect(res.headers['Cache-Control']).toBe('public, max-age=60');
  });

  it('never overwrites an already-set Cache-Control', async () => {
    const res = makeRes();
    res.header('Cache-Control', 'no-store');
    await cacheControl({ maxAge: 60 })({} as any, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('validates directives at construction time, not per request', () => {
    expect(() => cacheControl({})).toThrow(/at least one directive/);
  });
});

describe('noCache preset', () => {
  it('sets the never-cache header trio', async () => {
    const res = makeRes();
    await noCache({} as any, res);
    expect(res.headers['Cache-Control']).toBe(
      'no-store, no-cache, must-revalidate',
    );
  });

  it('respects an earlier Cache-Control', async () => {
    const res = makeRes();
    res.header('Cache-Control', 'public');
    await noCache({} as any, res);
    expect(res.headers['Cache-Control']).toBe('public');
  });
});
