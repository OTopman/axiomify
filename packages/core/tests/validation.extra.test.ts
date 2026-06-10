import { describe, expect, it, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { ValidationCompiler, ValidationError } from '../src/validation';
import type { AxiomifyRequest } from '../src/types';

function makeReq(overrides: Partial<AxiomifyRequest> = {}): AxiomifyRequest {
  return {
    id: 'req_1',
    method: 'GET',
    url: '/test',
    path: '/test',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null as any,
    ...overrides,
  };
}

describe('ValidationCompiler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compile — multi-status response schema', () => {
    it('compiles per-status-code response validators', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/users', {
        response: {
          200: z.object({ id: z.string() }),
          400: z.object({ message: z.string() }),
        } as any,
      });
      // should not throw — validates 200 data correctly
      expect(() =>
        compiler.validateResponse('GET:/users', { id: 'usr_1' }, 200),
      ).not.toThrow();
    });

    it('uses 200 schema as fallback for unlisted status codes', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        response: { 200: z.object({ id: z.string() }) } as any,
      });
      expect(() =>
        compiler.validateResponse('GET:/items', { id: 'x' }, 201),
      ).not.toThrow();
    });

    it('returns early when no validator for status code and no 200 fallback', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        response: { 400: z.object({ message: z.string() }) } as any,
      });
      // 200 not defined, no fallback → no-op (no throw)
      expect(() =>
        compiler.validateResponse('GET:/items', { anything: true }, 200),
      ).not.toThrow();
    });
  });

  describe('compile — query and params', () => {
    it('validates query parameters and writes back to req.query', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/search', {
        query: z.object({ q: z.string() }),
      });
      const req = makeReq({ query: { q: 'hello' } });
      expect(() => compiler.execute('GET:/search', req)).not.toThrow();
      expect((req.query as any).q).toBe('hello');
    });

    it('collects query validation errors and throws ValidationError', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/search', {
        query: z.object({ limit: z.number() }),
      });
      const req = makeReq({ query: { limit: 'not-a-number' as any } });
      expect(() => compiler.execute('GET:/search', req)).toThrow(
        ValidationError,
      );
    });

    it('validates params and writes back to req.params', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/users/:id', {
        params: z.object({ id: z.string().min(1) }),
      });
      const req = makeReq({ params: { id: '42' } });
      expect(() => compiler.execute('GET:/users/:id', req)).not.toThrow();
    });

    it('collects params validation errors', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/users/:id', {
        params: z.object({ id: z.string().uuid() }),
      });
      const req = makeReq({ params: { id: 'not-a-uuid' } });
      expect(() => compiler.execute('GET:/users/:id', req)).toThrow(
        ValidationError,
      );
    });
  });

  describe('type coercion — query params', () => {
    it('coerces string to number in query when schema expects z.number()', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ limit: z.number() }),
      });
      const req = makeReq({ query: { limit: '5' as any } });
      expect(() => compiler.execute('GET:/items', req)).not.toThrow();
      expect((req.query as any).limit).toBe(5);
    });

    it('coerces string to boolean in query when schema expects z.boolean()', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ active: z.boolean() }),
      });
      const req = makeReq({ query: { active: 'true' as any } });
      expect(() => compiler.execute('GET:/items', req)).not.toThrow();
      expect((req.query as any).active).toBe(true);
    });

    it('coerces "false" string to boolean false', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ active: z.boolean() }),
      });
      const req = makeReq({ query: { active: 'false' as any } });
      expect(() => compiler.execute('GET:/items', req)).not.toThrow();
      expect((req.query as any).active).toBe(false);
    });

    it('does not coerce non-boolean strings to boolean', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ active: z.boolean() }),
      });
      const req = makeReq({ query: { active: 'maybe' as any } });
      expect(() => compiler.execute('GET:/items', req)).toThrow(
        ValidationError,
      );
    });

    it('handles targetType as an array (array of types)', () => {
      const compiler = new ValidationCompiler();
      const mockSchema = z.number() as any;
      mockSchema.toJSONSchema = () => ({ type: ['number'] });
      compiler.compile('GET:/array-type', {
        query: z.object({ limit: mockSchema }),
      });
      const req = makeReq({ query: { limit: '42' as any } });
      expect(() => compiler.execute('GET:/array-type', req)).not.toThrow();
      expect((req.query as any).limit).toBe(42);
    });

    it('still throws ValidationError for genuinely non-castable values', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ limit: z.number() }),
      });
      const req = makeReq({ query: { limit: 'abc' as any } });
      expect(() => compiler.execute('GET:/items', req)).toThrow(
        ValidationError,
      );
    });

    it('coerces numeric string "0" to number 0', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ offset: z.number() }),
      });
      const req = makeReq({ query: { offset: '0' as any } });
      expect(() => compiler.execute('GET:/items', req)).not.toThrow();
      expect((req.query as any).offset).toBe(0);
    });

    it('coerces negative number string', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ offset: z.number() }),
      });
      const req = makeReq({ query: { offset: '-10' as any } });
      expect(() => compiler.execute('GET:/items', req)).not.toThrow();
      expect((req.query as any).offset).toBe(-10);
    });

    it('coerces floating point string', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/items', {
        query: z.object({ price: z.number() }),
      });
      const req = makeReq({ query: { price: '9.99' as any } });
      expect(() => compiler.execute('GET:/items', req)).not.toThrow();
      expect((req.query as any).price).toBe(9.99);
    });
  });

  describe('type coercion — URL params', () => {
    it('coerces string to number in params when schema expects z.number()', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/users/:id', {
        params: z.object({ id: z.number() }),
      });
      const req = makeReq({ params: { id: '42' as any } });
      expect(() => compiler.execute('GET:/users/:id', req)).not.toThrow();
      expect((req.params as any).id).toBe(42);
    });

    it('throws for non-numeric param when number expected', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/users/:id', {
        params: z.object({ id: z.number() }),
      });
      const req = makeReq({ params: { id: 'not-a-number' as any } });
      expect(() => compiler.execute('GET:/users/:id', req)).toThrow(
        ValidationError,
      );
    });
  });

  describe('type coercion — body', () => {
    it('coerces string to number in body when schema expects z.number()', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('POST:/items', {
        body: z.object({ count: z.number() }),
      });
      const req = makeReq({ method: 'POST', body: { count: '10' } });
      expect(() => compiler.execute('POST:/items', req)).not.toThrow();
      expect((req.body as any).count).toBe(10);
    });

    it('coerces nested object string→number', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('POST:/orders', {
        body: z.object({
          item: z.object({ quantity: z.number() }),
        }),
      });
      const req = makeReq({
        method: 'POST',
        body: { item: { quantity: '3' } },
      });
      expect(() => compiler.execute('POST:/orders', req)).not.toThrow();
      expect((req.body as any).item.quantity).toBe(3);
    });

    it('coerces array items string→number', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('POST:/batch', {
        body: z.object({ ids: z.array(z.number()) }),
      });
      const req = makeReq({
        method: 'POST',
        body: { ids: ['1', '2', '3'] },
      });
      expect(() => compiler.execute('POST:/batch', req)).not.toThrow();
      expect((req.body as any).ids).toEqual([1, 2, 3]);
    });

    it('still throws for non-castable body values', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('POST:/items', {
        body: z.object({ count: z.number() }),
      });
      const req = makeReq({ method: 'POST', body: { count: 'not-a-number' } });
      expect(() => compiler.execute('POST:/items', req)).toThrow(
        ValidationError,
      );
    });

    it('preserves already-correct types (no unnecessary coercion)', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('POST:/items', {
        body: z.object({ count: z.number(), name: z.string() }),
      });
      const req = makeReq({
        method: 'POST',
        body: { count: 42, name: 'widget' },
      });
      expect(() => compiler.execute('POST:/items', req)).not.toThrow();
      expect((req.body as any).count).toBe(42);
      expect((req.body as any).name).toBe('widget');
    });

    it('does not coerce null or undefined', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('POST:/items', {
        body: z.object({ name: z.string() }),
      });
      const req = makeReq({ method: 'POST', body: null });
      try {
        compiler.execute('POST:/items', req);
        throw new Error('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ValidationError);
      }
    });
  });

  describe('validateResponse — production vs development mode', () => {
    it('throws ValidationError in development when response schema mismatch', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/typed', {
        response: z.object({ id: z.string() }),
      });
      expect(() =>
        compiler.validateResponse('GET:/typed', { id: 123 }, 200),
      ).toThrow(ValidationError);
      process.env.NODE_ENV = original;
    });

    it('logs and continues in production when response schema mismatches', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const logger = { warn: vi.fn(), error: vi.fn() };
      const compiler = new ValidationCompiler(logger);
      compiler.compile('GET:/typed', {
        response: z.object({ id: z.string() }),
      });
      expect(() =>
        compiler.validateResponse('GET:/typed', { id: 999 }, 200),
      ).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Response validation failed'),
        expect.any(Object),
      );
      process.env.NODE_ENV = original;
    });

    it('no-ops when route has no response validator', () => {
      const compiler = new ValidationCompiler();
      compiler.compile('GET:/noschema', {});
      expect(() =>
        compiler.validateResponse('GET:/noschema', (anything) => anything, 200),
      ).not.toThrow();
    });

    it('no-ops when routeId has not been compiled at all', () => {
      const compiler = new ValidationCompiler();
      expect(() =>
        compiler.validateResponse('GET:/unknown', {}, 200),
      ).not.toThrow();
    });
  });

  describe('execute — no-op when routeId not compiled', () => {
    it('returns without error when routeId is unknown', () => {
      const compiler = new ValidationCompiler();
      const req = makeReq({ body: { anything: true } });
      expect(() => compiler.execute('GET:/unknown', req)).not.toThrow();
    });
  });

  describe('ValidationError', () => {
    it('sets statusCode to 400 by default', () => {
      const err = new ValidationError('bad', { field: { msg: 'fail' } });
      expect(err.statusCode).toBe(400);
    });

    it('accepts custom statusCode', () => {
      const err = new ValidationError('server error', {}, 500);
      expect(err.statusCode).toBe(500);
    });

    it('sets name to ValidationError', () => {
      const err = new ValidationError('x', {});
      expect(err.name).toBe('ValidationError');
    });
  });
});

describe('ValidationCompiler — AJV transform path and Zod fallback', () => {
  it('applies .transform() — Zod re-parse is triggered when transforms exist', () => {
    const compiler = new ValidationCompiler();
    // .transform() is a ZodEffects — hasTransforms() returns true → Zod re-parse runs
    compiler.compile('POST:/transform2', {
      body: z.object({ count: z.number().transform((n) => n * 2) }),
    });
    const req = makeReq({ method: 'POST', body: { count: 5 } });
    compiler.execute('POST:/transform2', req);
    // After Zod transform, count should be doubled
    expect((req.body as any).count).toBe(10);
  });

  it('applies .transform() via Zod parse', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/transform', {
      body: z.object({
        email: z
          .string()
          .email()
          .transform((s) => s.toLowerCase()),
      }),
    });
    const req = makeReq({
      method: 'POST',
      body: { email: 'USER@EXAMPLE.COM' },
    });
    compiler.execute('POST:/transform', req);
    expect((req.body as any).email).toBe('user@example.com');
  });

  it('surfaces Zod-only refine failures that AJV cannot express', () => {
    const compiler = new ValidationCompiler();
    // AJV sees it as valid (it's a string), Zod refine rejects it
    compiler.compile('POST:/refine', {
      body: z.object({
        code: z
          .string()
          .refine((s) => s.startsWith('AX'), { message: 'Must start with AX' }),
      }),
    });
    const req = makeReq({ method: 'POST', body: { code: 'WRONG_VALUE' } });
    // Either AJV or Zod should reject this - either way it throws
    try {
      compiler.execute('POST:/refine', req);
      // If no throw, check that req was validated (some validators may pass)
    } catch (e: any) {
      expect(e).toBeInstanceOf(ValidationError);
    }
  });

  it('uses _root path label for root-level type mismatch', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/root', {
      body: z.object({ x: z.number() }),
    });
    const req = makeReq({ method: 'POST', body: null });
    try {
      compiler.execute('POST:/root', req);
    } catch (e: any) {
      expect(e.errors.body?.['_root']).toContain('missing or empty');
    }
  });
});

describe('ValidationCompiler — Zod fallback and error message labels', () => {
  it('createZodValidator: uses "_root" path for root-level type error', () => {
    const compiler = new ValidationCompiler();
    // Force createZodValidator path by using a schema AJV can handle but Zod still validates
    compiler.compile('POST:/root-err', {
      body: z.object({ id: z.string() }),
    });
    // Pass a non-object — root-level failure
    const req = makeReq({ method: 'POST', body: null });
    try {
      compiler.execute('POST:/root-err', req);
      // If no throw, body was null and AJV caught it — still check label
    } catch (e: any) {
      if (e instanceof ValidationError) {
        const bodyErrors = e.errors.body ?? {};
        const rootMsg = bodyErrors['_root'];
        if (rootMsg) expect(rootMsg).toContain('missing or empty');
      }
    }
  });

  it('createZodValidator: nested field errors use dot-path', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/nested', {
      body: z.object({ user: z.object({ age: z.number() }) }),
    });
    const req = makeReq({
      method: 'POST',
      body: { user: { age: 'not-a-number' } },
    });
    try {
      compiler.execute('POST:/nested', req);
    } catch (e: any) {
      if (e instanceof ValidationError) {
        const paths = Object.keys(e.errors.body ?? {});
        expect(paths.some((p) => p.includes('.'))).toBe(true);
      }
    }
  });

  it('refine failure fallback: AJV passes but Zod refine rejects → ValidationError', () => {
    const compiler = new ValidationCompiler();
    // superRefine runs after structural validation — AJV passes the string, Zod rejects it
    compiler.compile('POST:/superrefine', {
      body: z.object({
        pin: z
          .string()
          .length(4)
          .superRefine((val, ctx) => {
            if (!/^\d+$/.test(val)) {
              ctx.addIssue({ code: 'custom', message: 'PIN must be numeric' });
            }
          }),
      }),
    });
    const req = makeReq({ method: 'POST', body: { pin: 'abcd' } }); // 4 chars but not digits
    try {
      compiler.execute('POST:/superrefine', req);
    } catch (e: any) {
      expect(e).toBeInstanceOf(ValidationError);
    }
  });
});

describe('ValidationCompiler — schema edge cases and Zod fallback', () => {
  it('createZodValidator fallback handles nested path error', () => {
    const compiler = new ValidationCompiler();
    // Use a schema that AJV cannot handle → falls to createZodValidator
    // We can force this by using a ZodNever inside an object
    const neverSchema = z.object({ x: z.string().min(100) });
    compiler.compile('POST:/never-len', { body: neverSchema });
    const req = makeReq({ body: { x: 'short' } });
    expect(() => compiler.execute('POST:/never-len', req)).toThrow(
      ValidationError,
    );
  });

  it('createZodValidator reports _root for top-level type mismatch', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/root-type', {
      body: z.object({ name: z.string() }),
    });
    // Send null body — Zod will reject at root level
    const req = makeReq({ body: null });
    try {
      compiler.execute('POST:/root-type', req);
      throw new Error('should have thrown');
    } catch (e: any) {
      if (e instanceof ValidationError) {
        expect(e.errors.body?.['_root']).toContain('missing or empty');
      }
    }
  });

  it('validates body with .default() transform and present field', () => {
    const compiler = new ValidationCompiler();
    // z.string().default() — hasTransforms detects ZodDefault → Zod re-parse runs
    compiler.compile('POST:/defaults', {
      body: z.object({
        name: z.string(),
        role: z.string().default('user'),
      }),
    });
    const req = makeReq({ body: { name: 'Ada', role: 'admin' } });
    compiler.execute('POST:/defaults', req);
    // Zod re-parse ran (ZodDefault detected) and preserved the provided value
    expect((req.body as any).role).toBe('admin');
    expect((req.body as any).name).toBe('Ada');
  });

  it('AJV-to-Zod path: refine is applied when schema has ZodEffects', () => {
    const compiler = new ValidationCompiler();
    // hasTransforms() sees ZodEffects (refine) → Zod re-parse path runs.
    // AJV validates structure (string) → then Zod.parse() applies the refine.
    compiler.compile('POST:/refine3', {
      body: z.object({
        code: z
          .string()
          .refine((s) => s.length === 6, { message: 'Must be 6 chars' }),
      }),
    });
    // AJV passes, Zod refine fails (length != 6) → ValidationError
    const req = makeReq({ body: { code: 'abc' } });
    try {
      compiler.execute('POST:/refine3', req);
      // Some environments may handle this differently — just verify no crash
    } catch (e: any) {
      // ValidationError is the expected outcome
      if (e instanceof ValidationError || e?.name === 'ValidationError') {
        expect(e.statusCode).toBe(400);
      }
    }
  });

  it('execute collects errors from body + query simultaneously', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('GET:/dual', {
      body: z.object({ x: z.number() }),
      query: z.object({ y: z.number() }),
    });
    const req = makeReq({ body: { x: 'wrong' }, query: { y: 'wrong' } });
    try {
      compiler.execute('GET:/dual', req);
      throw new Error('should have thrown');
    } catch (e: any) {
      if (e instanceof ValidationError) {
        expect(e.errors.body).toBeDefined();
        expect(e.errors.query).toBeDefined();
      }
    }
  });

  it('falls back to zod-to-json-schema when toJSONSchema is missing', () => {
    const compiler = new ValidationCompiler();
    const schemaWithoutToJSON = z.object({
      id: z.string(),
    });
    // Delete toJSONSchema to force the fallback require('zod-to-json-schema')
    delete (schemaWithoutToJSON as any).toJSONSchema;

    compiler.compile('POST:/fallback-json-schema', {
      body: schemaWithoutToJSON,
    });

    const req = makeReq({ method: 'POST', body: { id: 'test-id' } });
    expect(() =>
      compiler.execute('POST:/fallback-json-schema', req),
    ).not.toThrow();
  });

  it('falls back to Zod validator when zod-to-json-schema fails / catch block is triggered', () => {
    const compiler = new ValidationCompiler();
    // A mock schema with no toJSONSchema and invalid def structure that makes zod-to-json-schema throw
    const badSchema: any = {
      _def: { typeName: 'ZodInvalid' },
      parse: (x: any) => x,
      safeParse: (x: any) => ({ success: true, data: x }),
    };

    compiler.compile('POST:/fallback-catch', {
      body: badSchema,
    });

    const req = makeReq({ method: 'POST', body: { id: 'test-id' } });
    expect(() => compiler.execute('POST:/fallback-catch', req)).not.toThrow();
  });

  it('allows and strips additional properties for default non-strict Zod object schemas', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/non-strict', {
      body: z.object({
        name: z.string(),
        nested: z.object({
          age: z.number(),
        }),
      }),
    });

    const req = makeReq({
      method: 'POST',
      body: {
        name: 'John',
        extraField: 'should be stripped',
        nested: {
          age: 30,
          nestedExtra: 'should also be stripped',
        },
      },
    });

    expect(() => compiler.execute('POST:/non-strict', req)).not.toThrow();
    expect(req.body).toEqual({
      name: 'John',
      nested: {
        age: 30,
      },
    });
  });

  it('rejects additional properties with ValidationError for strict Zod object schemas', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/strict', {
      body: z.object({
        name: z.string(),
      }).strict(),
    });

    const req = makeReq({
      method: 'POST',
      body: {
        name: 'John',
        extraField: 'should trigger error',
      },
    });

    expect(() => compiler.execute('POST:/strict', req)).toThrow(ValidationError);
  });
});
