import { describe, expect, it } from 'vitest';
import { sanitizeInput } from '../src/sanitize';

describe('sanitizeInput', () => {
  it('returns primitives unchanged', () => {
    expect(sanitizeInput(42)).toBe(42);
    expect(sanitizeInput('hello')).toBe('hello');
    expect(sanitizeInput(true)).toBe(true);
    expect(sanitizeInput(null)).toBeNull();
    expect(sanitizeInput(undefined)).toBeUndefined();
  });

  it('strips __proto__ from plain objects', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"safe":"yes"}');
    const result = sanitizeInput(input) as any;
    expect(result.safe).toBe('yes');
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('strips constructor key from objects', () => {
    const result = sanitizeInput({ constructor: { bad: true }, safe: 'ok' }) as any;
    expect(result.safe).toBe('ok');
    expect(result.constructor).toBeUndefined();
  });

  it('strips prototype key from objects', () => {
    const result = sanitizeInput({ prototype: { evil: true }, safe: 'ok' }) as any;
    expect(result.safe).toBe('ok');
    expect(result.prototype).toBeUndefined();
  });

  it('sanitizes nested objects recursively', () => {
    const result = sanitizeInput({
      user: { name: 'Ada', __proto__: { x: 1 } as any },
      safe: true,
    }) as any;
    expect(result.user.name).toBe('Ada');
    expect(result.user.__proto__).toBeUndefined();
  });

  it('sanitizes arrays and their elements', () => {
    const result = sanitizeInput([
      { safe: 1, __proto__: {} as any },
      { safe: 2, constructor: {} as any },
    ]) as any[];
    expect(result[0].safe).toBe(1);
    expect(result[0].__proto__).toBeUndefined();
    expect(result[1].safe).toBe(2);
    expect(result[1].constructor).toBeUndefined();
  });

  it('preserves normal object properties', () => {
    const input = { a: 1, b: 'hello', c: [1, 2, 3], d: { nested: true } };
    const result = sanitizeInput(input) as typeof input;
    expect(result).toMatchObject(input);
  });

  it('handles empty objects and arrays', () => {
    expect(sanitizeInput({})).toEqual({});
    expect(sanitizeInput([])).toEqual([]);
  });
});
