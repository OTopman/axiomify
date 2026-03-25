export class AxiomifyError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly metadata?: Record<string, unknown>;

  constructor(opts: {
    message: string;
    code: string;
    statusCode?: number;
    metadata?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'AxiomifyError';
    this.code = opts.code;
    this.statusCode = opts.statusCode || 500;
    this.metadata = opts.metadata;
    Error.captureStackTrace(this, this.constructor);
  }

  static BadRequest(msg: string, meta?: Record<string, unknown>) {
    return new AxiomifyError({
      message: msg,
      code: 'BAD_REQUEST',
      statusCode: 400,
      metadata: meta,
    });
  }

  static Unauthorized(msg: string = 'Unauthorized') {
    return new AxiomifyError({
      message: msg,
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
  }

  static NotFound(msg: string = 'Not Found') {
    return new AxiomifyError({
      message: msg,
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  }

  static Internal(msg: string = 'Internal Server Error') {
    return new AxiomifyError({
      message: msg,
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  }
}
