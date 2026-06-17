import { describe, expect, it } from 'vitest';
import {
  AxiomifyError,
  HttpError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  UnprocessableError,
  TooManyRequestsError,
  InternalServerError,
  ServiceUnavailableError,
  GatewayTimeoutError,
} from '../src/errors';

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

  it('HttpError accepts status and message', () => {
    const err = new HttpError(418, "I'm a teapot");
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe("I'm a teapot");
    expect(err.name).toBe('HttpError');
  });

  it('BadRequestError defaults to 400', () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad Request');
    expect(err.name).toBe('BadRequestError');

    const custom = new BadRequestError('invalid input');
    expect(custom.message).toBe('invalid input');
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

  it('ForbiddenError defaults to 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Forbidden');
    expect(err.name).toBe('ForbiddenError');

    const custom = new ForbiddenError('no access');
    expect(custom.message).toBe('no access');
  });

  it('ConflictError defaults to 409', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Conflict');
    expect(err.name).toBe('ConflictError');

    const custom = new ConflictError('already exists');
    expect(custom.message).toBe('already exists');
  });

  it('UnprocessableError defaults to 422', () => {
    const err = new UnprocessableError();
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Unprocessable Entity');
    expect(err.name).toBe('UnprocessableError');

    const custom = new UnprocessableError('validation error');
    expect(custom.message).toBe('validation error');
  });

  it('TooManyRequestsError defaults to 429', () => {
    const err = new TooManyRequestsError();
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('Too Many Requests');
    expect(err.name).toBe('TooManyRequestsError');

    const custom = new TooManyRequestsError('rate limited');
    expect(custom.message).toBe('rate limited');
  });

  it('InternalServerError defaults to 500', () => {
    const err = new InternalServerError();
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Internal Server Error');
    expect(err.name).toBe('InternalServerError');

    const custom = new InternalServerError('db down');
    expect(custom.message).toBe('db down');
  });

  it('ServiceUnavailableError defaults to 503', () => {
    const err = new ServiceUnavailableError();
    expect(err.statusCode).toBe(503);
    expect(err.message).toBe('Service Unavailable');
    expect(err.name).toBe('ServiceUnavailableError');

    const custom = new ServiceUnavailableError('overloaded');
    expect(custom.message).toBe('overloaded');
  });

  it('GatewayTimeoutError defaults to 504', () => {
    const err = new GatewayTimeoutError();
    expect(err.statusCode).toBe(504);
    expect(err.message).toBe('Gateway Timeout');
    expect(err.name).toBe('GatewayTimeoutError');

    const custom = new GatewayTimeoutError('backend timeout');
    expect(custom.message).toBe('backend timeout');
  });
});
