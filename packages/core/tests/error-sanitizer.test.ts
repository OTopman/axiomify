import { describe, expect, it, vi } from 'vitest';
import { createErrorSanitizer } from '../src/validation';

describe('createErrorSanitizer', () => {
  it('returns null on invalid error types', () => {
    const sanitize = createErrorSanitizer();
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeNull();
    expect(sanitize('error string')).toBeNull();
    expect(sanitize(42)).toBeNull();
  });

  it('accepts a custom logger', () => {
    const mockLogger = { warn: vi.fn(), error: vi.fn() };
    const sanitize = createErrorSanitizer({ logger: mockLogger });
    expect(sanitize({ name: 'SomeError' })).toBeNull();
  });

  describe('Prisma errors', () => {
    const sanitize = createErrorSanitizer();

    it('sanitizes P2002 conflict error with target', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { target: ['email'] },
      };
      expect(sanitize(err)).toEqual({
        statusCode: 409,
        message: 'Conflict: Unique constraint failed',
        data: { target: ['email'] },
      });
    });

    it('sanitizes P2002 conflict error without target', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      };
      expect(sanitize(err)).toEqual({
        statusCode: 409,
        message: 'Conflict: Unique constraint failed',
        data: undefined,
      });
    });

    it('sanitizes P2025 not found error with cause', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
        meta: { cause: 'Record to update not found' },
      };
      expect(sanitize(err)).toEqual({
        statusCode: 404,
        message: 'Record to update not found',
      });
    });

    it('sanitizes P2025 not found error without cause', () => {
      const err = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
      };
      expect(sanitize(err)).toEqual({
        statusCode: 404,
        message: 'Resource not found',
      });
    });

    it('sanitizes general Prisma errors starting with P20', () => {
      const err = {
        code: 'P2003',
      };
      expect(sanitize(err)).toEqual({
        statusCode: 400,
        message: 'Database error: P2003',
      });
    });

    it('sanitizes Prisma errors with constructor name check', () => {
      class PrismaClientKnownRequestError extends Error {
        code = 'P2002';
      }
      const err = new PrismaClientKnownRequestError('msg');
      expect(sanitize(err)).toEqual({
        statusCode: 409,
        message: 'Conflict: Unique constraint failed',
        data: undefined,
      });
    });
  });

  describe('Other DB errors (QueryFailedError, SequelizeDatabaseError, MongoError)', () => {
    const sanitize = createErrorSanitizer();

    it('handles duplicate key via code 11000', () => {
      const err = {
        name: 'MongoError',
        code: '11000',
      };
      expect(sanitize(err)).toEqual({
        statusCode: 409,
        message: 'Conflict: Unique constraint failed',
      });
    });

    it('handles duplicate key via message string', () => {
      const err = {
        name: 'QueryFailedError',
        message: 'duplicate key value violates unique constraint',
      };
      expect(sanitize(err)).toEqual({
        statusCode: 409,
        message: 'Conflict: Unique constraint failed',
      });
    });

    it('handles general DB failures', () => {
      const err = {
        name: 'SequelizeDatabaseError',
        message: 'something broke in query',
      };
      expect(sanitize(err)).toEqual({
        statusCode: 400,
        message: 'Database operation failed',
      });
    });
  });

  it('returns null on non-matching errors', () => {
    const sanitize = createErrorSanitizer();
    const err = new Error('ordinary error');
    expect(sanitize(err)).toBeNull();
  });
});
