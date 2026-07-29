import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  computeEtag,
  ifNoneMatchMatches,
  parseIfNoneMatch,
} from '../src/etag';

describe('computeEtag', () => {
  it('emits a weak tag by default', () => {
    const tag = computeEtag('hello');
    expect(tag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
  });

  it('emits a strong tag when requested', () => {
    const tag = computeEtag('hello', 'strong');
    expect(tag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
  });

  it('carries the full sha1 digest (27 base64url chars)', () => {
    const expected = createHash('sha1')
      .update('payload')
      .digest('base64url')
      .slice(0, 27);
    expect(computeEtag('payload', 'strong')).toBe(`"${expected}"`);
  });

  it('is deterministic and content-sensitive', () => {
    expect(computeEtag('a')).toBe(computeEtag('a'));
    expect(computeEtag('a')).not.toBe(computeEtag('b'));
  });

  it('accepts Buffer payloads', () => {
    expect(computeEtag(Buffer.from('abc'), 'strong')).toBe(
      computeEtag('abc', 'strong'),
    );
  });
});

describe('parseIfNoneMatch', () => {
  it('parses a single quoted tag', () => {
    expect(parseIfNoneMatch('"abc"')).toEqual(['"abc"']);
  });

  it('parses a comma-separated list', () => {
    expect(parseIfNoneMatch('"a", "b" , "c"')).toEqual(['"a"', '"b"', '"c"']);
  });

  it('parses weak prefixes', () => {
    expect(parseIfNoneMatch('W/"a", "b"')).toEqual(['W/"a"', '"b"']);
  });

  it('parses the * wildcard', () => {
    expect(parseIfNoneMatch('*')).toEqual(['*']);
  });

  it('keeps commas inside quoted opaque-tags intact', () => {
    expect(parseIfNoneMatch('"a,b", "c"')).toEqual(['"a,b"', '"c"']);
  });

  it('handles non-compliant unquoted tokens leniently', () => {
    expect(parseIfNoneMatch('abc123, "d"')).toEqual(['abc123', '"d"']);
  });

  it('handles an unterminated quote leniently', () => {
    expect(parseIfNoneMatch('"abc')).toEqual(['"abc']);
  });
});

describe('ifNoneMatchMatches (RFC 9110 weak comparison)', () => {
  const etag = 'W/"xyz"';

  it('returns false for a missing header', () => {
    expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
    expect(ifNoneMatchMatches('', etag)).toBe(false);
    expect(ifNoneMatchMatches('   ', etag)).toBe(false);
  });

  it('matches * against any representation', () => {
    expect(ifNoneMatchMatches('*', etag)).toBe(true);
    expect(ifNoneMatchMatches('*', undefined)).toBe(true);
  });

  it('matches identical strong tags', () => {
    expect(ifNoneMatchMatches('"xyz"', '"xyz"')).toBe(true);
  });

  it('weak-compares: W/ prefix on either side is ignored', () => {
    expect(ifNoneMatchMatches('W/"xyz"', '"xyz"')).toBe(true);
    expect(ifNoneMatchMatches('"xyz"', 'W/"xyz"')).toBe(true);
    expect(ifNoneMatchMatches('W/"xyz"', 'W/"xyz"')).toBe(true);
  });

  it('matches within comma lists', () => {
    expect(ifNoneMatchMatches('"a", W/"xyz", "b"', etag)).toBe(true);
  });

  it('rejects non-matching tags', () => {
    expect(ifNoneMatchMatches('"other"', etag)).toBe(false);
    expect(ifNoneMatchMatches('"a", "b"', etag)).toBe(false);
  });

  it('returns false when the current etag is undefined (non-star)', () => {
    expect(ifNoneMatchMatches('"a"', undefined)).toBe(false);
  });

  it('folds string[] header values', () => {
    expect(ifNoneMatchMatches(['"a"', 'W/"xyz"'], etag)).toBe(true);
  });

  it('accepts a lowercase w/ weakness prefix leniently', () => {
    expect(ifNoneMatchMatches('w/"xyz"', etag)).toBe(true);
  });
});
