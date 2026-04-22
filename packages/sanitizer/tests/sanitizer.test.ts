import { describe, expect, it } from 'vitest';
import { normalizeHpp, sanitizeInput } from '../src';

describe('sanitizer', () => {
  it('removes script tags and null bytes', () => {
    const result = sanitizeInput({ value: '<script>alert(1)</script>abc\u0000def' }) as any;
    expect(result.value).not.toContain('<script>');
    expect(result.value).toContain('abcdef');
  });

  it('normalizes duplicated query params', () => {
    expect(normalizeHpp({ q: ['first', 'second'] })).toEqual({ q: 'second' });
  });
});
