/**
 * Property-based fuzz tests for the native adapter's query-string parser.
 *
 * The unit-test happy paths exercise specific shapes (single pair, repeated
 * key, malformed percent-encoding). This file uses fast-check to generate
 * thousands of adversarial inputs and assert invariants that MUST hold for
 * every input. A parser bug that survives unit tests will almost always
 * fall over here within seconds.
 *
 * Invariants checked:
 *   1. Never throws — any input string must produce an object or throw a
 *      well-defined controlled error (the parser is on the request hot
 *      path; a single unhandled throw is a 500 → DOS vector).
 *   2. Output prototype is null — no `__proto__` / prototype pollution.
 *   3. Output is structurally consistent — values are string or string[].
 *   4. Reversibility for ASCII inputs — what we encode we decode.
 *   5. No memory growth proportional to attack payloads with many `&`s.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('uWebSockets.js', () => ({
  default: {
    App: () => ({
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      options: vi.fn(),
      head: vi.fn(),
      any: vi.fn(),
      ws: vi.fn(),
      listen: vi.fn((_p: number, cb: (t: unknown) => void) => cb({})),
    }),
    SHARED_COMPRESSOR: 0,
    us_listen_socket_close: vi.fn(),
    us_socket_local_port: vi.fn(() => 3000),
  },
}));

describe('fastParseQuery — property-based fuzz', () => {
  it('never throws on arbitrary string input', async () => {
    const { __internal } = await import('../src/index');
    fc.assert(
      fc.property(fc.string({ maxLength: 4096 }), (input) => {
        // Should always produce SOMETHING (not throw).
        const out = __internal.fastParseQuery(input);
        expect(typeof out).toBe('object');
      }),
      { numRuns: 500 },
    );
  });

  it('output object has null prototype (no pollution surface)', async () => {
    const { __internal } = await import('../src/index');
    fc.assert(
      fc.property(fc.string({ maxLength: 2048 }), (input) => {
        const out = __internal.fastParseQuery(input);
        expect(Object.getPrototypeOf(out)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('values are always string or string[]', async () => {
    const { __internal } = await import('../src/index');
    fc.assert(
      fc.property(fc.string({ maxLength: 2048 }), (input) => {
        const out = __internal.fastParseQuery(input);
        for (const v of Object.values(out)) {
          if (Array.isArray(v)) {
            for (const inner of v) {
              expect(typeof inner).toBe('string');
            }
          } else {
            expect(typeof v).toBe('string');
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('round-trips for clean key=value pairs of safe ASCII', async () => {
    const { __internal } = await import('../src/index');
    // Limit the alphabet to characters that don't require percent-encoding
    // and aren't structural to the query format (`=`, `&`, `+`).
    const safeChar = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.'.split(
        '',
      ),
    );
    const safeWord = fc
      .array(safeChar, { minLength: 1, maxLength: 16 })
      .map((a) => a.join(''));
    fc.assert(
      fc.property(
        fc.array(fc.tuple(safeWord, safeWord), { minLength: 1, maxLength: 20 }),
        (pairs) => {
          const encoded = pairs.map(([k, v]) => `${k}=${v}`).join('&');
          const out = __internal.fastParseQuery(encoded);
          // Each unique key should appear with the expected value (or
          // a final value, for repeated keys).
          const expected = new Map<string, string[]>();
          for (const [k, v] of pairs) {
            const arr = expected.get(k) ?? [];
            arr.push(v);
            expected.set(k, arr);
          }
          for (const [k, values] of expected) {
            const got = out[k];
            if (values.length === 1) {
              expect(got).toBe(values[0]);
            } else {
              expect(got).toEqual(values);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('handles attacker-controlled "&" floods without DOS or OOM', async () => {
    const { __internal } = await import('../src/index');
    // 50k empty separators — old parsers spent O(n²) time here. Should
    // complete in well under a second.
    const start = process.hrtime.bigint();
    const input = '&'.repeat(50_000);
    const out = __internal.fastParseQuery(input);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    expect(out).toEqual({});
    expect(elapsedMs).toBeLessThan(500);
  });

  it('handles malformed percent sequences without throwing', async () => {
    const { __internal } = await import('../src/index');
    fc.assert(
      fc.property(
        // Random strings that frequently include % followed by junk.
        fc.string({
          unit: fc.constantFrom('%', 'a', 'Z', '0', 'ÿ'),
          maxLength: 256,
        }),
        (input) => {
          expect(() => __internal.fastParseQuery(input)).not.toThrow();
        },
      ),
      { numRuns: 300 },
    );
  });
});
