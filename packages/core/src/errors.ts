export class AxiomifyError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AxiomifyError';
  }
}

export class NotFoundError extends AxiomifyError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class UnauthorizedError extends AxiomifyError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}
