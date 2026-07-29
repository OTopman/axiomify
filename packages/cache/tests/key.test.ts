import { describe, expect, it } from 'vitest';
import {
  KEY_SEPARATOR,
  buildCacheKey,
  getRequestHeader,
  normalizeQuery,
  pathKeyPrefix,
  requestCacheKey,
} from '../src/key';

const SEP = KEY_SEPARATOR;

describe('normalizeQuery', () => {
  it('returns empty string for nullish / non-object input', () => {
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery('a=1')).toBe('');
    expect(normalizeQuery({})).toBe('');
  });

  it('sorts keys so parameter order does not matter', () => {
    expect(normalizeQuery({ b: '2', a: '1' })).toBe(
      normalizeQuery({ a: '1', b: '2' }),
    );
    expect(normalizeQuery({ b: '2', a: '1' })).toBe('a=1&b=2');
  });

  it('sorts repeated-parameter arrays', () => {
    expect(normalizeQuery({ tag: ['b', 'a'] })).toBe('tag=a&tag=b');
  });

  it('percent-encodes keys and values', () => {
    expect(normalizeQuery({ 'a&b': 'x=y' })).toBe('a%26b=x%3Dy');
  });

  it('serializes undefined values as bare keys', () => {
    expect(normalizeQuery({ flag: undefined })).toBe('flag');
  });
});

describe('buildCacheKey / pathKeyPrefix', () => {
  it('joins method, path and normalized query with NUL', () => {
    expect(buildCacheKey('GET', '/users', { b: '2', a: '1' })).toBe(
      `GET${SEP}/users${SEP}a=1&b=2`,
    );
  });

  it('appends vary pairs', () => {
    expect(
      buildCacheKey('GET', '/u', undefined, [['accept', 'text/html']]),
    ).toBe(`GET${SEP}/u${SEP}${SEP}accept:text/html`);
  });

  it('cannot collide across path/query boundaries', () => {
    expect(buildCacheKey('GET', '/a', { b: 'c' })).not.toBe(
      buildCacheKey('GET', '/a/b', { '': 'c' }),
    );
  });

  it('pathKeyPrefix is a prefix of every key for that path, with boundary', () => {
    const key = buildCacheKey('GET', '/users', { a: '1' });
    expect(key.startsWith(pathKeyPrefix('GET', '/users'))).toBe(true);
    expect(
      buildCacheKey('GET', '/users2', {}).startsWith(
        pathKeyPrefix('GET', '/users'),
      ),
    ).toBe(false);
  });
});

describe('getRequestHeader', () => {
  it('reads case-insensitively and folds arrays', () => {
    const req = { headers: { accept: 'a', 'x-multi': ['1', '2'] } } as any;
    expect(getRequestHeader(req, 'Accept')).toBe('a');
    expect(getRequestHeader(req, 'X-Multi')).toBe('1, 2');
    expect(getRequestHeader(req, 'missing')).toBeUndefined();
  });
});

describe('requestCacheKey', () => {
  const req = (over: any = {}) =>
    ({
      method: 'GET',
      path: '/p',
      query: { a: '1' },
      headers: {},
      ...over,
    }) as any;

  it('builds a key without vary headers', () => {
    expect(requestCacheKey(req(), [])).toBe(`GET${SEP}/p${SEP}a=1`);
  });

  it('folds global vary header values into the primary key', () => {
    const k1 = requestCacheKey(req({ headers: { 'accept-language': 'en' } }), [
      'accept-language',
    ]);
    const k2 = requestCacheKey(req({ headers: { 'accept-language': 'fr' } }), [
      'accept-language',
    ]);
    expect(k1).not.toBe(k2);
    expect(k1).toContain('accept-language:en');
  });

  it('missing vary headers key as empty values', () => {
    expect(requestCacheKey(req(), ['accept'])).toContain(`${SEP}accept:`);
  });
});
