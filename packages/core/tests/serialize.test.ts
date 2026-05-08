import { describe, expect, it, vi, afterEach } from 'vitest';
import { makeSerialize } from '../src/serialize';

describe('makeSerialize', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe('single-argument (object) form', () => {
    it('wraps a 1-arg serializer and passes SerializerInput through', () => {
      const fn = vi.fn((input: any) => ({ wrapped: input.data }));
      const serialize = makeSerialize(fn);
      const result = serialize({ data: 42, message: 'ok', statusCode: 200, isError: false });
      expect(result).toEqual({ wrapped: 42 });
      expect(fn).toHaveBeenCalledOnce();
    });

    it('recognises arrow functions with destructured param as 1-arg', () => {
      const fn = ({ data }: any) => ({ d: data });
      const serialize = makeSerialize(fn);
      expect(serialize({ data: 'hello' })).toEqual({ d: 'hello' });
    });
  });

  describe('5-argument legacy form', () => {
    it('wraps a 5-arg serializer and maps positional args correctly', () => {
      const fn = vi.fn((data: any, msg: any, code: any, isErr: any) => ({
        data, msg, code, isErr,
      }));
      // Trick fn.length: define with 5 named params
      const fn5 = function(data: any, message: any, statusCode: any, isError: any, req: any) {
        return { data, message, statusCode, isError };
      };
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const serialize = makeSerialize(fn5 as any);
      const result = serialize({ data: 'x', message: 'msg', statusCode: 201, isError: false });
      expect(result).toMatchObject({ data: 'x', message: 'msg', statusCode: 201 });
    });

    it('emits deprecation warning in non-production mode', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fn5 = function(a: any, b: any, c: any, d: any, e: any) { return {}; };
      makeSerialize(fn5 as any);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
      process.env.NODE_ENV = original;
    });

    it('does NOT emit warning in production', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fn5 = function(a: any, b: any, c: any, d: any, e: any) { return {}; };
      makeSerialize(fn5 as any);
      expect(warn).not.toHaveBeenCalled();
      process.env.NODE_ENV = original;
    });
  });
});
