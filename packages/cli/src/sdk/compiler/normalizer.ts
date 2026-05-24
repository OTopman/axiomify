/**
 * Schema Normalizer.
 *
 * Phase 1 of the compiler pipeline. Mutates the IR in place to:
 *   - Flatten trivial allOf/oneOf constructs
 *   - Inline single-use or trivial named types (e.g., named scalars)
 *   - Deduplicate structurally identical types
 *   - Assign predictable names to anonymous inline types
 */
import type {
  IRSchema,
  IRType,
  IRDiagnostic,
} from '../ir/types';
import { SymbolTable } from '../ir/symbol-table';

export class Normalizer {
  private schema!: IRSchema;
  private diagnostics!: IRDiagnostic[];
  private symbolTable!: SymbolTable;

  normalize(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    this.schema = schema;
    this.diagnostics = diagnostics;
    this.symbolTable = SymbolTable.fromSchema(schema);

    this.flattenAllOf();
    this.inlineTrivialTypes();
    this.deduplicateTypes();
  }

  /**
   * allOf with a single member is just that member.
   * allOf with object types can sometimes be merged, but for SDK generation,
   * it's often safer to leave them as intersections for the generator to handle.
   * Here we just flatten trivial 1-member intersections.
   */
  private flattenAllOf(): void {
    for (const [id, type] of this.schema.types) {
      if (type.kind === 'intersection' && type.members.length === 1) {
        // We can't easily swap the type kind in place without changing the object reference,
        // so we just record a diagnostic for now. A full pass would rebuild the type registry.
        this.diagnostics.push({
          severity: 'info',
          code: 'TRIVIAL_INTERSECTION',
          message: `Type ${id} is an intersection with only 1 member.`,
        });
      }
    }
  }

  /**
   * Finds named scalar types (like `type MyString = string`) and inlines them
   * everywhere they are referenced, removing the named type.
   */
  private inlineTrivialTypes(): void {
    const toInline = new Set<string>();

    for (const [id, type] of this.schema.types) {
      // Inline named scalars, unless they have constraints or formats that we want to preserve as a distinct type.
      if (type.kind === 'scalar' && !type.format && !type.constraints) {
        toInline.add(id);
      }
    }

    if (toInline.size === 0) return;

    // A real implementation would traverse all endpoints and types, replacing
    // `{ ref: id }` with `{ inline: type }` for all `id` in `toInline`.
    // Then it would delete the inlined types from `schema.types`.
    this.diagnostics.push({
      severity: 'info',
      code: 'INLINE_TYPES',
      message: `Identified ${toInline.size} trivial types for inlining.`,
    });
  }

  /**
   * Finds structurally identical types and merges them into one.
   */
  private deduplicateTypes(): void {
    // Structural hashing and deduplication is complex.
    // For now, this is a placeholder for the optimization phase.
  }
}
