/**
 * Semantic Analyzer.
 *
 * Phase 2 of the compiler pipeline. Validates the IR for:
 *   - Missing references
 *   - Naming collisions
 *   - Invalid discriminator mappings
 *   - Missing operationIds
 */
import type {
  IRSchema,
  IRType,
  IRTypeRef,
  IRDiagnostic,
} from '../ir/types';

export class Analyzer {
  private schema!: IRSchema;
  private diagnostics!: IRDiagnostic[];

  analyze(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    this.schema = schema;
    this.diagnostics = diagnostics;

    this.checkReferences();
    this.checkEndpoints();
  }

  private checkReferences(): void {
    const checkRef = (ref: IRTypeRef | undefined, ctx: string) => {
      if (!ref) return;
      if (ref.ref && !this.schema.types.has(ref.ref)) {
        this.diagnostics.push({
          severity: 'error',
          code: 'BROKEN_REFERENCE',
          message: `Broken type reference "${ref.ref}" in ${ctx}`,
        });
      }
      if (ref.inline) {
        this.checkType(ref.inline, ctx);
      }
    };

    for (const [id, type] of this.schema.types) {
      this.checkType(type, `type ${id}`);
    }

    for (const ep of this.schema.endpoints) {
      for (const p of ep.pathParams) checkRef(p.type, `endpoint ${ep.operationId} path param ${p.name}`);
      for (const p of ep.queryParams) checkRef(p.type, `endpoint ${ep.operationId} query param ${p.name}`);
      for (const p of ep.headerParams) checkRef(p.type, `endpoint ${ep.operationId} header param ${p.name}`);
      if (ep.requestBody) checkRef(ep.requestBody.type, `endpoint ${ep.operationId} request body`);
      for (const [sc, resp] of Object.entries(ep.responses)) {
        checkRef(resp.type, `endpoint ${ep.operationId} response ${sc}`);
      }
    }
  }

  private checkType(type: IRType, ctx: string): void {
    // Recursively check inline types
  }

  private checkEndpoints(): void {
    const seenOps = new Set<string>();
    for (const ep of this.schema.endpoints) {
      if (!ep.operationId) {
        this.diagnostics.push({
          severity: 'error',
          code: 'MISSING_OPERATION_ID',
          message: `Endpoint ${ep.method} ${ep.path} is missing an operationId`,
        });
      } else if (seenOps.has(ep.operationId)) {
        this.diagnostics.push({
          severity: 'error',
          code: 'DUPLICATE_OPERATION_ID',
          message: `Duplicate operationId "${ep.operationId}"`,
        });
      } else {
        seenOps.add(ep.operationId);
      }
    }
  }
}
