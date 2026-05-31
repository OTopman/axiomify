import { describe, expect, it, vi, afterEach } from 'vitest';
import { makeSerialize } from '../src/serialize';

describe('makeSerialize', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('single-argument (object) form', () => {
    it('wraps a 1-arg serializer and passes SerializerInput through', () => {
      const fn = vi.fn((input: any) => ({ wrapped: input.data }));
      const serialize = makeSerialize(fn);
      // makeSerialize probes the serializer once at construction time to
      // detect async return values (which would corrupt response bodies).
      // Snapshot the call count so the actual send-path call is what we
      // assert on.
      const callsBefore = fn.mock.calls.length;
      const result = serialize({
        data: 42,
        message: 'ok',
        statusCode: 200,
        isError: false,
      });
      expect(result).toEqual({ wrapped: 42 });
      expect(fn.mock.calls.length - callsBefore).toBe(1);
    });

    it('rejects async serializers at construction time', () => {
      const asyncFn = (_input: any) => Promise.resolve({});
      expect(() => makeSerialize(asyncFn)).toThrow(/must be synchronous/);
    });

    it('recognises arrow functions with destructured param as 1-arg', () => {
      const fn = ({ data }: any) => ({ d: data });
      const serialize = makeSerialize(fn);
      expect(serialize({ data: 'hello' })).toEqual({ d: 'hello' });
    });
  });

  describe('5-argument legacy form — removed in 5.0.0', () => {
    // The legacy positional serializer form was deprecated through 4.x
    // and removed in 5.0.0. makeSerialize() now throws at construction
    // time rather than wrap, so users get a clear error instead of
    // silently miscompiled output.
    it('throws when given a multi-arg serializer (positional form)', () => {
      const fn5 = function (
        _data: any,
        _message: any,
        _statusCode: any,
        _isError: any,
        _req: any,
      ) {
        return {};
      };
      expect(() => makeSerialize(fn5 as any)).toThrow(/removed in v5\.0\.0/);
      expect(() => makeSerialize(fn5 as any)).toThrow(
        /single SerializerInput argument/,
      );
    });

    it('error message tells the user how to migrate', () => {
      const fn3 = function (_a: any, _b: any, _c: any) {
        return {};
      };
      try {
        makeSerialize(fn3 as any);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain(
          '({ data, message, statusCode, isError, req }) =>',
        );
      }
    });
  });
});
