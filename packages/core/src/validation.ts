import { ZodTypeAny } from 'zod';
import type { AxiomifyRequest, RouteSchema } from './types';

export class ValidationError extends Error {
  public readonly errors: Record<string, Record<string, string>>;
  public readonly statusCode = 400;

  constructor(message: string, errors: Record<string, Record<string, string>>) {
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

/**
 * Duck-types a value as a Zod schema. Avoids reaching into `_def` which is an
 * internal field that has changed across Zod majors. Any object exposing
 * `safeParse` is treated as a validator.
 */
function isZodSchema(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).safeParse === 'function'
  );
}

export class ValidationCompiler {
  private compiledSchemas = new Map<
    string,
    {
      body?: ValidateFunction;
      query?: ValidateFunction;
      params?: ValidateFunction;
      response?: ValidateFunction | Record<number, ValidateFunction>;
    }
  >();

  public compile(routeId: string, schema: RouteSchema): void {
    const compiled: {
      body?: ValidateFunction;
      query?: ValidateFunction;
      params?: ValidateFunction;
      response?: ValidateFunction | Record<number, ValidateFunction>;
    } = {};

    if (schema.body) compiled.body = this.createZodValidator(schema.body);
    if (schema.query) compiled.query = this.createZodValidator(schema.query);
    if (schema.params) compiled.params = this.createZodValidator(schema.params);

    if (schema.response) {
      if (isZodSchema(schema.response)) {
        compiled.response = this.createZodValidator(schema.response);
      } else {
        // It's a Record<number, ZodTypeAny> map
        const responseMap: Record<number, ValidateFunction> = {};
        for (const [code, zodSchema] of Object.entries(schema.response)) {
          responseMap[Number(code)] = this.createZodValidator(
            zodSchema as ZodTypeAny,
          );
        }
        compiled.response = responseMap;
      }
    }

    this.compiledSchemas.set(routeId, compiled);
  }

  public execute(routeId: string, req: AxiomifyRequest): void {
    const validators = this.compiledSchemas.get(routeId);
    if (!validators) return;

    const errors: Record<string, Record<string, string>> = {};
    let hasErrors = false;

    if (validators.body) {
      const result = validators.body(req.body);
      if (!result.valid) {
        errors.body = result.errors!;
        hasErrors = true;
      } else {
        Object.defineProperty(req, 'body', {
          value: result.data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    if (validators.query) {
      const result = validators.query(req.query);
      if (!result.valid) {
        errors.query = result.errors!;
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
        errors.params = result.errors!;
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

  public validateResponse(
    routeId: string,
    data: unknown,
    statusCode: number = 200,
  ): void {
    const validators = this.compiledSchemas.get(routeId);
    if (!validators || !validators.response) return;

    let validator: ValidateFunction;

    if (typeof validators.response === 'function') {
      validator = validators.response; // Single schema applies to all successful responses
    } else {
      validator = validators.response[statusCode] || validators.response[200];
      if (!validator) return; // No schema defined for this specific status code
    }

    const result = validator(data);

    if (!result.valid) {
      if (process.env.NODE_ENV !== 'production') {
        // Wrap the error in a namespaced 'response' object
        throw new ValidationError('Response validation failed', {
          response: result.errors || {},
        });
      } else {
        console.warn(
          `[Axiomify] Response validation mismatch for route ${routeId}:`,
          result.errors,
        );
      }
    }
  }

  private createZodValidator(schema: ZodTypeAny): ValidateFunction {
    return (data: unknown) => {
      const result = schema.safeParse(data);

      if (result.success) {
        return { valid: true, data: result.data };
      }

      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
        const isRootMissing =
          issue.path.length === 0 && issue.message === 'Required';
        errors[path] = isRootMissing
          ? 'The request body is missing or empty'
          : issue.message;
      });

      return { valid: false, errors };
    };
  }
}
