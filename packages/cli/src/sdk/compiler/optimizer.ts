/**
 * Optimizer.
 *
 * Phase 3 of the compiler pipeline. Uses the TypeGraph to:
 *   - Eliminate dead types (types not reachable from any endpoint/event)
 *   - Simplify unions (flatten nested, remove duplicates, widen redundant literal types)
 *   - Merge intersections of objects into single unified object types
 */
import { TypeGraph } from '../ir/type-graph';
import type {
  IRDiagnostic,
  IRIntersectionType,
  IRObjectType,
  IRScalarType,
  IRSchema,
  IRType,
  IRTypeRef,
  IRUnionType,
} from '../ir/types';

export class Optimizer {
  private schema!: IRSchema;
  private diagnostics!: IRDiagnostic[];

  optimize(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    this.schema = schema;
    this.diagnostics = diagnostics;

    // 1. Simplify unions and intersections across all registered types
    this.simplifyTypes();

    // 2. Perform dead type elimination
    this.pruneDeadTypes();
  }

  /**
   * Traverse all types in the registry and simplify unions/intersections.
   */
  private simplifyTypes(): void {
    let simplifiedCount = 0;

    for (const [id, type] of this.schema.types) {
      const simplified = this.simplifyType(type);
      if (simplified !== type) {
        this.schema.types.set(id, simplified);
        simplifiedCount++;
      }
    }

    if (simplifiedCount > 0) {
      this.diagnostics.push({
        severity: 'info',
        code: 'TYPE_SIMPLIFICATION',
        message: `Simplified ${simplifiedCount} complex types (union/intersection optimization).`,
      });
    }
  }

  private simplifyType(type: IRType): IRType {
    if (type.kind === 'union') {
      return this.optimizeUnion(type);
    }
    if (type.kind === 'intersection') {
      return this.optimizeIntersection(type);
    }
    return type;
  }

  /**
   * Flattens nested unions, removes duplicates, and simplifies literals.
   * E.g. A | (B | C) -> A | B | C
   * E.g. string | "hello" -> string
   */
  private optimizeUnion(union: IRUnionType): IRType {
    const flattenedMembers: IRTypeRef[] = [];

    const collectMembers = (members: IRTypeRef[]) => {
      for (const member of members) {
        let resolved: IRType | undefined;
        if (member.ref) {
          resolved = this.schema.types.get(member.ref);
        } else if (member.inline) {
          resolved = member.inline;
        }

        if (resolved && resolved.kind === 'union') {
          // Recurse into nested union
          collectMembers(resolved.members);
        } else {
          flattenedMembers.push(member);
        }
      }
    };

    collectMembers(union.members);

    // Filter duplicates and widen literals
    const uniqueRefs: IRTypeRef[] = [];
    const seenRefs = new Set<string>();
    let hasStringScalar = false;
    let hasNumberScalar = false;
    let hasBooleanScalar = false;

    // First check for wide types
    for (const ref of flattenedMembers) {
      let resolved: IRType | undefined;
      if (ref.ref) resolved = this.schema.types.get(ref.ref);
      else if (ref.inline) resolved = ref.inline;

      if (resolved && resolved.kind === 'scalar') {
        const scalarType = resolved as IRScalarType;
        if (scalarType.scalar === 'string') hasStringScalar = true;
        if (scalarType.scalar === 'number' || scalarType.scalar === 'integer')
          hasNumberScalar = true;
        if (scalarType.scalar === 'boolean') hasBooleanScalar = true;
      }
    }

    // Now filter
    for (const ref of flattenedMembers) {
      let resolved: IRType | undefined;
      if (ref.ref) resolved = this.schema.types.get(ref.ref);
      else if (ref.inline) resolved = ref.inline;

      if (resolved) {
        // If wide string type exists, skip string literal members
        if (
          resolved.kind === 'literal' &&
          typeof resolved.value === 'string' &&
          hasStringScalar
        ) {
          continue;
        }
        // If wide number type exists, skip number literal members
        if (
          resolved.kind === 'literal' &&
          typeof resolved.value === 'number' &&
          hasNumberScalar
        ) {
          continue;
        }
        // If wide boolean type exists, skip boolean literal members
        if (
          resolved.kind === 'literal' &&
          typeof resolved.value === 'boolean' &&
          hasBooleanScalar
        ) {
          continue;
        }
      }

      // Quick stringification for identity check
      const key = ref.ref
        ? `ref:${ref.ref}`
        : `inline:${JSON.stringify(ref.inline)}`;
      if (!seenRefs.has(key)) {
        seenRefs.add(key);
        uniqueRefs.push(ref);
      }
    }

    if (uniqueRefs.length === 1) {
      // Union of 1 type is just that type
      const single = uniqueRefs[0];
      if (single.inline) return single.inline;
      if (single.ref) {
        const res = this.schema.types.get(single.ref);
        if (res) return res;
      }
    }

    return {
      ...union,
      members: uniqueRefs,
    };
  }

  /**
   * Flattens intersections and merges pure object intersections.
   */
  private optimizeIntersection(intersection: IRIntersectionType): IRType {
    const flattenedMembers: IRTypeRef[] = [];

    const collectMembers = (members: IRTypeRef[]) => {
      for (const member of members) {
        let resolved: IRType | undefined;
        if (member.ref) {
          resolved = this.schema.types.get(member.ref);
        } else if (member.inline) {
          resolved = member.inline;
        }

        if (resolved && resolved.kind === 'intersection') {
          collectMembers(resolved.members);
        } else {
          flattenedMembers.push(member);
        }
      }
    };

    collectMembers(intersection.members);

    // Resolve all members to see if they are objects
    const resolvedObjects: IRObjectType[] = [];
    const nonObjects: IRTypeRef[] = [];

    for (const ref of flattenedMembers) {
      let resolved: IRType | undefined;
      if (ref.ref) resolved = this.schema.types.get(ref.ref);
      else if (ref.inline) resolved = ref.inline;

      if (resolved && resolved.kind === 'object') {
        resolvedObjects.push(resolved);
      } else {
        nonObjects.push(ref);
      }
    }

    // If everything is an object, merge them into a single object type
    if (resolvedObjects.length > 0 && nonObjects.length === 0) {
      const mergedFields = new Map<string, any>();
      for (const obj of resolvedObjects) {
        for (const field of obj.fields) {
          mergedFields.set(field.name, field);
        }
      }

      return {
        id: intersection.id,
        kind: 'object',
        fields: Array.from(mergedFields.values()),
        description: intersection.description,
      };
    }

    return {
      ...intersection,
      members: flattenedMembers,
    };
  }

  /**
   * Computes reachability from endpoints & events, then prunes unreferenced types.
   */
  private pruneDeadTypes(): void {
    const graph = TypeGraph.fromSchema(this.schema);
    const rootIds = new Set<string>();

    const addRef = (ref: IRTypeRef | undefined) => {
      if (!ref) return;
      if (ref.ref) rootIds.add(ref.ref);
      if (ref.inline) {
        if (ref.inline.kind === 'array') addRef(ref.inline.items);
        if (ref.inline.kind === 'object') {
          for (const f of ref.inline.fields || []) addRef(f.type);
          if (typeof ref.inline.additionalProperties === 'object') {
            addRef(ref.inline.additionalProperties as IRTypeRef);
          }
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

    // 1. Mark roots from endpoints
    for (const ep of this.schema.endpoints) {
      for (const p of ep.pathParams) addRef(p.type);
      for (const p of ep.queryParams) addRef(p.type);
      for (const p of ep.headerParams) addRef(p.type);
      if (ep.requestBody) addRef(ep.requestBody.type);
      for (const resp of Object.values(ep.responses)) addRef(resp.type);
      if (ep.streaming?.itemType) addRef(ep.streaming.itemType);
      if (ep.streaming?.eventTypes) {
        for (const ref of Object.values(ep.streaming.eventTypes)) addRef(ref);
      }
    }

    // 2. Mark roots from event contracts
    if (this.schema.events) {
      for (const event of this.schema.events) {
        addRef(event.payload);
        addRef(event.ackPayload);
      }
    }

    // 3. Compute reachable types
    const reachable = graph.reachableFrom([...rootIds]);

    // 4. Prune dead types
    let pruned = 0;
    for (const id of this.schema.types.keys()) {
      if (!reachable.has(id)) {
        this.schema.types.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.diagnostics.push({
        severity: 'info',
        code: 'DEAD_TYPE_ELIMINATION',
        message: `Pruned ${pruned} unreachable types.`,
      });
    }
  }
}
