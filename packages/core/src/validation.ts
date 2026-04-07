import { ZodTypeAny } from 'zod';
import type { AxiomifyRequest, RouteSchema } from './types';

export class ValidationError extends Error {
  public readonly errors: Record<string, string>;
  public readonly statusCode = 400;

  constructor(message: string, errors: Record<string, string>) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

type ValidateFunction = (data: unknown) => {
  valid: boolean;
  data?: any;
  errors?: Record<string, string>;
};

export class ValidationCompiler {
  private compiledSchemas = new Map<
    string,
    {
      body?: ValidateFunction;
      query?: ValidateFunction;
      params?: ValidateFunction;
    }
  >();

  public compile(routeId: string, schema: RouteSchema): void {
    const compiled: {
      body?: ValidateFunction;
      query?: ValidateFunction;
      params?: ValidateFunction;
    } = {};

    if (schema.body) compiled.body = this.createZodValidator(schema.body);
    if (schema.query) compiled.query = this.createZodValidator(schema.query);
    if (schema.params) compiled.params = this.createZodValidator(schema.params);

    this.compiledSchemas.set(routeId, compiled);
  }

  public execute(routeId: string, req: AxiomifyRequest): void {
    const validators = this.compiledSchemas.get(routeId);
    if (!validators) return;

    const errors: Record<string, string> = {};
    let hasErrors = false;

    if (validators.body) {
      const result = validators.body(req.body);
      if (!result.valid) {
        Object.assign(errors, result.errors);
        hasErrors = true;
      } else {
        Object.defineProperty(req, 'body', {
          value: result.data,
          writable: true, // Allow further modifications downstream
          enumerable: true, // Ensure it shows up in console.log/serialization
          configurable: true, // Allow it to be redefined later if needed
        });
      } // Overwrite with Zod's transformed data
    }

    if (validators.query) {
      const result = validators.query(req.query);
      if (!result.valid) {
        Object.assign(errors, result.errors);
        hasErrors = true;
      } else {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    if (validators.params) {
      const result = validators.params(req.params);
      if (!result.valid) {
        Object.assign(errors, result.errors);
        hasErrors = true;
      } else {
        Object.defineProperty(req, 'params', {
          value: result.data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    if (hasErrors) {
      throw new ValidationError('Request validation failed', errors);
    }
  }

  private createZodValidator(schema: ZodTypeAny): ValidateFunction {
    return (data: unknown) => {
      const result = schema.safeParse(data);

      if (result.success) {
        return { valid: true, data: result.data }; // Return parsed/transformed data
      }

      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        console.log(issue)
       const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
       errors[path] =
         issue.message === 'Required'
           ? 'The entire request body/payload is missing'
           : issue.message;
      });

      return { valid: false, errors };
    };
  }
}
