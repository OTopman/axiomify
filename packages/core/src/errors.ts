export class AxiomifyError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AxiomifyError';
  }
}

/**
 * Base class for all HTTP-semantic errors.
 *
 * The `RequestDispatcher` reads `.statusCode` to determine the HTTP response
 * status, so any subclass thrown from a handler is automatically reflected
 * in the response without a custom `onError` hook.
 *
 * @example
 * throw new HttpError(418, "I'm a teapot");
 */
export class HttpError extends AxiomifyError {
  constructor(statusCode: number, message: string) {
    super(message, statusCode);
    this.name = 'HttpError';
  }
}

// ── 4xx Client Errors ────────────────────────────────────────────────────────

export class BadRequestError extends HttpError {
  constructor(message = 'Bad Request') {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Resource not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class UnprocessableError extends HttpError {
  constructor(message = 'Unprocessable Entity') {
    super(422, message);
    this.name = 'UnprocessableError';
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message = 'Too Many Requests') {
    super(429, message);
    this.name = 'TooManyRequestsError';
  }
}

// ── 5xx Server Errors ────────────────────────────────────────────────────────

export class InternalServerError extends HttpError {
  constructor(message = 'Internal Server Error') {
    super(500, message);
    this.name = 'InternalServerError';
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service Unavailable') {
    super(503, message);
    this.name = 'ServiceUnavailableError';
  }
}

export class GatewayTimeoutError extends HttpError {
  constructor(message = 'Gateway Timeout') {
    super(504, message);
    this.name = 'GatewayTimeoutError';
  }
}
