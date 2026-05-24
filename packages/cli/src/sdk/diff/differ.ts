/**
 * Schema Diffing Engine.
 *
 * Compares two IR schemas and produces a structural diff.
 * Detects added, removed, and modified endpoints and types.
 */
import type { IRSchema, IREndpoint, IRType } from '../ir/types';

export type DiffChangeType = 'added' | 'removed' | 'modified';

export interface DiffResult {
  endpoints: Record<string, EndpointDiff>;
  types: Record<string, TypeDiff>;
}

export interface EndpointDiff {
  type: DiffChangeType;
  oldEndpoint?: IREndpoint;
  newEndpoint?: IREndpoint;
  changes?: FieldChange[];
}

export interface TypeDiff {
  type: DiffChangeType;
  oldType?: IRType;
  newType?: IRType;
  changes?: FieldChange[];
}

export interface FieldChange {
  path: string;
  type: DiffChangeType;
  oldValue?: unknown;
  newValue?: unknown;
}

export class SchemaDiffer {
  diff(oldSchema: IRSchema, newSchema: IRSchema): DiffResult {
    const result: DiffResult = { endpoints: {}, types: {} };

    // Diff endpoints
    const oldOps = new Map(oldSchema.endpoints.map(e => [e.operationId, e]));
    const newOps = new Map(newSchema.endpoints.map(e => [e.operationId, e]));

    for (const [id, oldEp] of oldOps) {
      const newEp = newOps.get(id);
      if (!newEp) {
        result.endpoints[id] = { type: 'removed', oldEndpoint: oldEp };
      } else {
        const changes = this.diffEndpoints(oldEp, newEp);
        if (changes.length > 0) {
          result.endpoints[id] = { type: 'modified', oldEndpoint: oldEp, newEndpoint: newEp, changes };
        }
      }
    }

    for (const [id, newEp] of newOps) {
      if (!oldOps.has(id)) {
        result.endpoints[id] = { type: 'added', newEndpoint: newEp };
      }
    }

    // Diff types (simplified - deeply diffing nested IR is complex)
    for (const [id, oldType] of oldSchema.types) {
      const newType = newSchema.types.get(id);
      if (!newType) {
        result.types[id] = { type: 'removed', oldType };
      } else {
        // Here we'd do a deep structural diff. For now, simple object equality.
        if (JSON.stringify(oldType) !== JSON.stringify(newType)) {
          result.types[id] = { type: 'modified', oldType, newType };
        }
      }
    }

    for (const [id, newType] of newSchema.types) {
      if (!oldSchema.types.has(id)) {
         result.types[id] = { type: 'added', newType };
      }
    }

    return result;
  }

  private diffEndpoints(oldEp: IREndpoint, newEp: IREndpoint): FieldChange[] {
    const changes: FieldChange[] = [];
    if (oldEp.path !== newEp.path) {
      changes.push({ path: 'path', type: 'modified', oldValue: oldEp.path, newValue: newEp.path });
    }
    if (oldEp.method !== newEp.method) {
      changes.push({ path: 'method', type: 'modified', oldValue: oldEp.method, newValue: newEp.method });
    }
    // A robust differ would check params, body, responses...
    return changes;
  }
}
