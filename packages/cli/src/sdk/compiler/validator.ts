/**
 * Validator.
 *
 * Phase 4 of the compiler pipeline. Performs a final integrity check
 * on the IR before it's passed to the code generators. Ensures no
 * invalid states exist.
 */
import type { IRSchema, IRDiagnostic } from '../ir/types';

export class Validator {
  validate(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    // 1. Ensure all operation IDs are unique (re-check after any transforms)
    const opIds = new Set<string>();
    for (const ep of schema.endpoints) {
      if (opIds.has(ep.operationId)) {
        diagnostics.push({
          severity: 'error',
          code: 'DUPLICATE_OPERATION_ID',
          message: `Operation ID "${ep.operationId}" is not unique.`,
        });
      }
      opIds.add(ep.operationId);
    }
    
    // 2. Ensure all types have an ID
    for (const [id, type] of schema.types) {
      if (!type.id) {
         diagnostics.push({
          severity: 'error',
          code: 'MISSING_TYPE_ID',
          message: `Type registered under "${id}" is missing its internal ID.`,
        });       
      } else if (type.id !== id) {
         diagnostics.push({
          severity: 'error',
          code: 'MISMATCHED_TYPE_ID',
          message: `Type registered under "${id}" has a mismatched internal ID "${type.id}".`,
        }); 
      }
    }
  }
}
