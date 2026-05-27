/**
 * Schema Transformer.
 *
 * Runs transformations on the IRSchema to inject headers, handle prefixing,
 * standardize responses, or apply plugin-driven custom alterations.
 */
import type { IRDiagnostic, IRSchema, IRTypeRef } from '../ir/types';

export interface IRTransformer {
  name: string;
  transform(schema: IRSchema, diagnostics: IRDiagnostic[]): void;
}

export class Transformer {
  private transformers: IRTransformer[] = [];

  register(transformer: IRTransformer): void {
    this.transformers.push(transformer);
  }

  transform(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    for (const tx of this.transformers) {
      try {
        tx.transform(schema, diagnostics);
      } catch (err: any) {
        diagnostics.push({
          severity: 'error',
          code: 'TRANSFORMER_ERROR',
          message: `Transformer "${tx.name}" failed: ${err?.message || err}`,
        });
      }
    }
  }
}

/**
 * Standard Header Injection Transformer.
 * Injects specified headers as query/header parameters into all endpoints.
 */
export class HeaderInjectorTransformer implements IRTransformer {
  name = 'HeaderInjector';
  constructor(private headers: Array<{ name: string; type: IRTypeRef; description?: string; required?: boolean }>) {}

  transform(schema: IRSchema): void {
    for (const ep of schema.endpoints) {
      for (const h of this.headers) {
        const exists = ep.headerParams.some(p => p.name.toLowerCase() === h.name.toLowerCase());
        if (!exists) {
          ep.headerParams.push({
            name: h.name,
            location: 'header',
            type: h.type,
            required: h.required ?? false,
            description: h.description,
          });
        }
      }
    }
  }
}

/**
 * Default Error Response Transformer.
 * Injects a standard error response shape (e.g., 400, 500) if not defined.
 */
export class DefaultErrorResponseTransformer implements IRTransformer {
  name = 'DefaultErrorResponse';
  constructor(
    private statusCodes: string[],
    private errorTypeRef: IRTypeRef,
    private description = 'Standard API error response'
  ) {}

  transform(schema: IRSchema): void {
    for (const ep of schema.endpoints) {
      for (const code of this.statusCodes) {
        if (!ep.responses[code]) {
          ep.responses[code] = {
            statusCode: code,
            description: this.description,
            type: this.errorTypeRef,
          };
        }
      }
    }
  }
}
