import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AxiomifyRequest } from '../src/types';
import { ValidationCompiler, ValidationError } from '../src/validation';

describe('ValidationCompiler', () => {
  it('skips validation silently if no schema is provided', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('GET:/test', {});

    const req = { body: { anything: 'goes' } } as AxiomifyRequest;
    expect(() => compiler.execute('GET:/test', req)).not.toThrow();
  });

  it('passes valid body and writes parsed Zod data back to req.body', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/users', {
      body: z.object({ age: z.string().transform(Number) }),
    });

    const req = { body: { age: '25' } } as AxiomifyRequest;
    compiler.execute('POST:/users', req);

    // The string '25' should be transformed to the number 25
    expect(req.body).toStrictEqual({ age: 25 });
  });

  it('throws ValidationError with structured map for invalid body', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/users', {
      body: z.object({ name: z.string() }),
    });

    const req = { body: { name: 123 } } as unknown as AxiomifyRequest;

    try {
      compiler.execute('POST:/users', req);
      expect.unreachable('Should have thrown ValidationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors.name).toBeDefined();
    }
  });

  it('returns a human-readable error when a required body is missing entirely', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/users', {
      body: z.object({ name: z.string() }),
    });

    const req = { body: undefined } as unknown as AxiomifyRequest;

    try {
      compiler.execute('POST:/users', req);
    } catch (err: any) {
      expect(err.errors['_root']).toBe('The request body is missing or empty');
    }
  });

  it('validates query and params independently', () => {
    const compiler = new ValidationCompiler();
    compiler.compile('GET:/search/:id', {
      query: z.object({ q: z.string() }),
      params: z.object({ id: z.string().uuid() }),
    });

    const req = {
      query: { q: 'test' },
      params: { id: 'invalid-uuid' },
    } as unknown as AxiomifyRequest;

    try {
      compiler.execute('GET:/search/:id', req);
    } catch (err: any) {
      expect(err.errors.id).toBeDefined();
      expect(err.errors.q).toBeUndefined();
    }
  });
});
