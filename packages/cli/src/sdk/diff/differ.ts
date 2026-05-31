/**
 * Schema Diffing Engine.
 *
 * Compares two IR schemas and produces a deep structural diff.
 * Detects added, removed, and modified endpoints, parameters, fields, and enums.
 */
import type { IREndpoint, IRSchema, IRType } from '../ir/types';

export type DiffChangeType = 'added' | 'removed' | 'modified';

export interface DiffResult {
  endpoints: Record<string, EndpointDiff>;
  types: Record<string, TypeDiff>;
}

export interface EndpointDiff {
  type: DiffChangeType;
  oldEndpoint?: IREndpoint;
  newEndpoint?: IREndpoint;
  changes: FieldChange[];
}

export interface TypeDiff {
  type: DiffChangeType;
  oldType?: IRType;
  newType?: IRType;
  changes: FieldChange[];
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

    // 1. Diff endpoints
    const oldOps = new Map(oldSchema.endpoints.map((e) => [e.operationId, e]));
    const newOps = new Map(newSchema.endpoints.map((e) => [e.operationId, e]));

    for (const [id, oldEp] of oldOps) {
      const newEp = newOps.get(id);
      if (!newEp) {
        result.endpoints[id] = {
          type: 'removed',
          oldEndpoint: oldEp,
          changes: [],
        };
      } else {
        const changes = this.diffEndpoints(oldEp, newEp);
        if (changes.length > 0) {
          result.endpoints[id] = {
            type: 'modified',
            oldEndpoint: oldEp,
            newEndpoint: newEp,
            changes,
          };
        }
      }
    }

    for (const [id, newEp] of newOps) {
      if (!oldOps.has(id)) {
        result.endpoints[id] = {
          type: 'added',
          newEndpoint: newEp,
          changes: [],
        };
      }
    }

    // 2. Diff types
    for (const [id, oldType] of oldSchema.types) {
      const newType = newSchema.types.get(id);
      if (!newType) {
        result.types[id] = { type: 'removed', oldType, changes: [] };
      } else {
        const changes = this.diffTypes(oldType, newType);
        if (changes.length > 0) {
          result.types[id] = { type: 'modified', oldType, newType, changes };
        }
      }
    }

    for (const [id, newType] of newSchema.types) {
      if (!oldSchema.types.has(id)) {
        result.types[id] = { type: 'added', newType, changes: [] };
      }
    }

    return result;
  }

  private diffEndpoints(oldEp: IREndpoint, newEp: IREndpoint): FieldChange[] {
    const changes: FieldChange[] = [];

    if (oldEp.path !== newEp.path) {
      changes.push({
        path: 'path',
        type: 'modified',
        oldValue: oldEp.path,
        newValue: newEp.path,
      });
    }
    if (oldEp.method !== newEp.method) {
      changes.push({
        path: 'method',
        type: 'modified',
        oldValue: oldEp.method,
        newValue: newEp.method,
      });
    }

    const diffParams = (
      oldParams: any[] = [],
      newParams: any[] = [],
      typeName: string,
    ) => {
      const oldMap = new Map((oldParams || []).map((p) => [p.name, p]));
      const newMap = new Map((newParams || []).map((p) => [p.name, p]));

      for (const [name, oldP] of oldMap) {
        const newP = newMap.get(name);
        if (!newP) {
          changes.push({
            path: `${typeName}.${name}`,
            type: 'removed',
            oldValue: oldP,
          });
        } else {
          if (JSON.stringify(oldP.type) !== JSON.stringify(newP.type)) {
            changes.push({
              path: `${typeName}.${name}.type`,
              type: 'modified',
              oldValue: oldP.type,
              newValue: newP.type,
            });
          }
          if (oldP.required !== newP.required) {
            changes.push({
              path: `${typeName}.${name}.required`,
              type: 'modified',
              oldValue: oldP.required,
              newValue: newP.required,
            });
          }
        }
      }

      for (const [name, newP] of newMap) {
        if (!oldMap.has(name)) {
          changes.push({
            path: `${typeName}.${name}`,
            type: 'added',
            newValue: newP,
          });
        }
      }
    };

    diffParams(oldEp.pathParams, newEp.pathParams, 'pathParams');
    diffParams(oldEp.queryParams, newEp.queryParams, 'queryParams');
    diffParams(oldEp.headerParams, newEp.headerParams, 'headerParams');

    // RequestBody check
    if (oldEp.requestBody && !newEp.requestBody) {
      changes.push({
        path: 'requestBody',
        type: 'removed',
        oldValue: oldEp.requestBody,
      });
    } else if (!oldEp.requestBody && newEp.requestBody) {
      changes.push({
        path: 'requestBody',
        type: 'added',
        newValue: newEp.requestBody,
      });
    } else if (oldEp.requestBody && newEp.requestBody) {
      if (
        JSON.stringify(oldEp.requestBody.type) !==
        JSON.stringify(newEp.requestBody.type)
      ) {
        changes.push({
          path: 'requestBody.type',
          type: 'modified',
          oldValue: oldEp.requestBody.type,
          newValue: newEp.requestBody.type,
        });
      }
      if (oldEp.requestBody.required !== newEp.requestBody.required) {
        changes.push({
          path: 'requestBody.required',
          type: 'modified',
          oldValue: oldEp.requestBody.required,
          newValue: newEp.requestBody.required,
        });
      }
    }

    return changes;
  }

  private diffTypes(oldType: IRType, newType: IRType): FieldChange[] {
    const changes: FieldChange[] = [];

    if (oldType.kind !== newType.kind) {
      changes.push({
        path: 'kind',
        type: 'modified',
        oldValue: oldType.kind,
        newValue: newType.kind,
      });
      return changes; // Do not compare further if type kind changed
    }

    if (oldType.kind === 'object' && newType.kind === 'object') {
      const oldFields = new Map(oldType.fields.map((f) => [f.name, f]));
      const newFields = new Map(newType.fields.map((f) => [f.name, f]));

      for (const [name, oldF] of oldFields) {
        const newF = newFields.get(name);
        if (!newF) {
          changes.push({
            path: `fields.${name}`,
            type: 'removed',
            oldValue: oldF,
          });
        } else {
          if (JSON.stringify(oldF.type) !== JSON.stringify(newF.type)) {
            changes.push({
              path: `fields.${name}.type`,
              type: 'modified',
              oldValue: oldF.type,
              newValue: newF.type,
            });
          }
          if (oldF.required !== newF.required) {
            changes.push({
              path: `fields.${name}.required`,
              type: 'modified',
              oldValue: oldF.required,
              newValue: newF.required,
            });
          }
        }
      }

      for (const [name, newF] of newFields) {
        if (!oldFields.has(name)) {
          changes.push({
            path: `fields.${name}`,
            type: 'added',
            newValue: newF,
          });
        }
      }
    }

    if (oldType.kind === 'enum' && newType.kind === 'enum') {
      const oldVals = new Set(oldType.values.map((v) => v.value));
      const newVals = new Set(newType.values.map((v) => v.value));

      for (const v of oldVals) {
        if (!newVals.has(v)) {
          changes.push({ path: `values.${v}`, type: 'removed', oldValue: v });
        }
      }
      for (const v of newVals) {
        if (!oldVals.has(v)) {
          changes.push({ path: `values.${v}`, type: 'added', newValue: v });
        }
      }
    }

    return changes;
  }
}
