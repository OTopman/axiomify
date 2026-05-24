/**
 * Optimizer.
 *
 * Phase 3 of the compiler pipeline. Uses the TypeGraph to:
 *   - Eliminate dead types (types not reachable from any endpoint)
 */
import type { IRSchema, IRDiagnostic } from '../ir/types';
import { TypeGraph } from '../ir/type-graph';

export class Optimizer {
  optimize(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    const graph = TypeGraph.fromSchema(schema);
    
    // 1. Find root types (used by endpoints)
    const rootIds = new Set<string>();
    
    const addRef = (ref: any) => { 
      if (!ref) return;
      if (ref.ref) rootIds.add(ref.ref); 
      if (ref.inline) {
         if (ref.inline.kind === 'array') addRef(ref.inline.items);
         if (ref.inline.kind === 'object') {
            for (const f of ref.inline.fields || []) addRef(f.type);
            if (typeof ref.inline.additionalProperties === 'object') addRef(ref.inline.additionalProperties);
         }
         if (ref.inline.kind === 'union' || ref.inline.kind === 'intersection') {
            for (const m of ref.inline.members || []) addRef(m);
         }
         if (ref.inline.kind === 'tuple') {
            for (const m of ref.inline.elements || []) addRef(m);
         }
         if (ref.inline.kind === 'map') {
            addRef(ref.inline.valueType);
         }
      }
    };

    for (const ep of schema.endpoints) {
      for (const p of ep.pathParams) addRef(p.type);
      for (const p of ep.queryParams) addRef(p.type);
      for (const p of ep.headerParams) addRef(p.type);
      if (ep.requestBody) addRef(ep.requestBody.type);
      for (const resp of Object.values(ep.responses)) addRef(resp.type);
    }

    // 2. Compute reachable types
    const reachable = graph.reachableFrom([...rootIds]);

    // 3. Prune dead types
    let pruned = 0;
    for (const id of schema.types.keys()) {
      if (!reachable.has(id)) {
        schema.types.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) {
      diagnostics.push({
        severity: 'info',
        code: 'DEAD_TYPE_ELIMINATION',
        message: `Pruned ${pruned} unreachable types.`,
      });
    }
  }
}
