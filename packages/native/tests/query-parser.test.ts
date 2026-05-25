/**
 * Tests for the internal query-string parser used by NativeAdapter.
 * These are platform-agnostic — they don't require uWS to load.
 */
import { describe, expect, it, vi } from 'vitest';

// Mock uWS so the adapter module loads on any platform / Node version.
vi.mock('uWebSockets.js', () => ({
  default: {
    App: () => ({
      get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(),
      del: vi.fn(), options: vi.fn(), head: vi.fn(), any: vi.fn(),
      ws: vi.fn(),
      listen: vi.fn((_p: number, cb: (t: unknown) => void) => cb({})),
    }),
    SHARED_COMPRESSOR: 0,
    us_listen_socket_close: vi.fn(),
    us_socket_local_port: vi.fn(() => 3000),
  },
}));

describe('fastParseQuery', () => {
  it('parses a single key/value pair', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('q=hello')).toEqual({ q: 'hello' });
  });

  it('parses multiple pairs', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('a=1&b=2&c=3')).toEqual({
      a: '1', b: '2', c: '3',
    });
  });

  it('decodes percent-encoded keys and values', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('name=Ada%20Lovelace&email=ada%40example.com'))
      .toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  it('replaces "+" with " " (form encoding)', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('q=hello+world')).toEqual({ q: 'hello world' });
  });

  it('groups repeated keys into an array', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('tag=a&tag=b&tag=c')).toEqual({
      tag: ['a', 'b', 'c'],
    });
  });

  it('treats key without value as empty string', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('flag&name=ada')).toEqual({
      flag: '', name: 'ada',
    });
  });

  it('returns empty object for empty input', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.fastParseQuery('')).toEqual({});
  });

  it('returns null-prototype object (no prototype pollution surface)', async () => {
    const { __internal } = await import('../src/index');
    const out = __internal.fastParseQuery('__proto__=evil');
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(({} as any).evil).toBeUndefined();
  });

  it('does NOT throw on malformed percent-encoding (regression: previously 500)', async () => {
    const { __internal } = await import('../src/index');
    // %E0 is a truncated UTF-8 lead byte — decodeURIComponent throws URIError.
    // The hardened parser should pass the raw bytes through instead.
    expect(() => __internal.fastParseQuery('bad=%E0')).not.toThrow();
    const out = __internal.fastParseQuery('bad=%E0');
    expect(out.bad).toBe('%E0');
  });

  it('does NOT throw on malformed key', async () => {
    const { __internal } = await import('../src/index');
    expect(() => __internal.fastParseQuery('%XY=value')).not.toThrow();
  });

  it('safeDecodeURIComponent returns input on malformed escape', async () => {
    const { __internal } = await import('../src/index');
    expect(__internal.safeDecodeURIComponent('%E0')).toBe('%E0');
    expect(__internal.safeDecodeURIComponent('%XY')).toBe('%XY');
    // Valid input is still decoded normally.
    expect(__internal.safeDecodeURIComponent('hello%20world')).toBe('hello world');
  });
});
