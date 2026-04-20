import { describe, expect, it } from 'vitest';
import { AxiomifyError, NotFoundError, UnauthorizedError } from '../src/errors';

/**
 * The error classes are tiny but had zero coverage. These tests verify the
 * status codes, default and custom messages, and Error-inheritance
 * relationships that other parts of the framework rely on.
 */
describe('Core error classes', () => {
  it('AxiomifyError carries message and defaults statusCode to 500', () => {
    const err = new AxiomifyError('boom');
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('AxiomifyError');
    expect(err).toBeInstanceOf(Error);
  });

  it('AxiomifyError accepts an explicit status code', () => {
    const err = new AxiomifyError('teapot', 418);
    expect(err.statusCode).toBe(418);
  });

  it('NotFoundError defaults to 404 with a generic message', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource not found');
    expect(err).toBeInstanceOf(AxiomifyError);
  });

  it('NotFoundError accepts a custom message', () => {
    const err = new NotFoundError('user 42 not found');
    expect(err.message).toBe('user 42 not found');
    expect(err.statusCode).toBe(404);
  });

  it('UnauthorizedError defaults to 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Unauthorized');
    expect(err).toBeInstanceOf(AxiomifyError);
  });

  it('UnauthorizedError accepts a custom message', () => {
    const err = new UnauthorizedError('token expired');
    expect(err.message).toBe('token expired');
    expect(err.statusCode).toBe(401);
  });
});
