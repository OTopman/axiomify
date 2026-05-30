/**
 * Schema Normalizer.
 *
 * Phase 1 of the compiler pipeline. Mutates the IR in place to:
 *   - Flatten trivial allOf/oneOf constructs (single-member wrappers)
 *   - Inline single-use trivial named types (named scalars without constraints)
 *   - Deduplicate structurally identical types (SHA-256 canonical hashing)
 *   - Promote anonymous inline types to named schema types
 *   - Normalize naming conventions (PascalCase types, camelCase fields)
 */
import crypto from 'crypto';
import type {
  IRSchema,
  IRType,
  IRTypeRef,
  IRField,
  IRDiagnostic,
  IRObjectType,
  IREndpoint,
  IRParameter,
  IREventContract,
} from '../ir/types';

export class Normalizer {
  private schema!: IRSchema;
  private diagnostics!: IRDiagnostic[];

  normalize(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    this.schema = schema;
    this.diagnostics = diagnostics;

    this.normalizeNaming();
    this.flattenAllOf();
    this.promoteAnonymousTypes();
    this.inlineTrivialTypes();
    this.deduplicateTypes();
  }

  // ─── Flatten allOf/oneOf ──────────────────────────────────────────

  /**
   * Flatten single-member intersections and unions into their sole member.
   * An `allOf: [X]` is equivalent to just `X`. Same for `oneOf: [X]`.
   * Also merges pure-object intersections into a single object type.
   */
  private flattenAllOf(): void {
    const toReplace = new Map<string, IRType>();

    for (const [id, type] of this.schema.types) {
      if (type.kind === 'intersection' && type.members.length === 1) {
        const member = type.members[0];
        if (member.ref) {
          const target = this.schema.types.get(member.ref);
          if (target) {
            toReplace.set(id, { ...target, id, description: type.description ?? target.description });
          }
        } else if (member.inline) {
          toReplace.set(id, { ...member.inline, id, description: type.description ?? member.inline.description });
        }
      }

      if (type.kind === 'union' && type.members.length === 1) {
        const member = type.members[0];
        if (member.ref) {
          const target = this.schema.types.get(member.ref);
          if (target) {
            toReplace.set(id, { ...target, id, description: type.description ?? target.description });
          }
        } else if (member.inline) {
          toReplace.set(id, { ...member.inline, id, description: type.description ?? member.inline.description });
        }
      }

      // Merge allOf with all-object members into a single object type
      if (type.kind === 'intersection' && type.members.length > 1) {
        const resolvedMembers = type.members
          .map((m) => {
            if (m.ref) return this.schema.types.get(m.ref);
            if (m.inline) return m.inline;
            return undefined;
          })
          .filter((t): t is IRType => !!t);

        if (resolvedMembers.every((m) => m.kind === 'object')) {
          const merged: IRField[] = [];
          const seen = new Set<string>();
          for (const member of resolvedMembers as IRObjectType[]) {
            for (const field of member.fields) {
              if (!seen.has(field.name)) {
                seen.add(field.name);
                merged.push(field);
              }
            }
          }
          toReplace.set(id, {
            id,
            kind: 'object',
            fields: merged,
            description: type.description,
          });
        }
      }
    }

    for (const [id, replacement] of toReplace) {
      this.schema.types.set(id, replacement);
    }

    if (toReplace.size > 0) {
      this.diagnostics.push({
        severity: 'info',
        code: 'FLATTEN_ALLOF',
        message: `Flattened ${toReplace.size} trivial intersection/union types.`,
      });
    }
  }

  // ─── Promote Anonymous Types ──────────────────────────────────────

  /**
   * Lift anonymous inline types from endpoint parameters, request bodies, and
   * responses into named schema types with predictable names. This makes the
   * generated SDK types more navigable.
   */
  private promoteAnonymousTypes(): void {
    let promoted = 0;

    const promoteRef = (ref: IRTypeRef, baseName: string): IRTypeRef => {
      if (!ref.inline) return ref;
      const inline = ref.inline;

      // Only promote complex types (objects, unions, intersections)
      if (inline.kind !== 'object' && inline.kind !== 'union' && inline.kind !== 'intersection') {
        return ref;
      }

      const typeName = this.ensureUniqueName(baseName);
      const namedType = { ...inline, id: typeName };
      this.schema.types.set(typeName, namedType);
      promoted++;
      return { ref: typeName, nullable: ref.nullable, isArray: ref.isArray };
    };

    for (const ep of this.schema.endpoints) {
      const opPascal = toPascalCase(ep.operationId);

      // Promote request body inline types
      if (ep.requestBody?.type.inline) {
        ep.requestBody.type = promoteRef(ep.requestBody.type, `${opPascal}Request`);
      }

      // Promote response inline types
      for (const [code, resp] of Object.entries(ep.responses)) {
        if (resp.type?.inline) {
          const suffix = code === '200' || code === '201' ? 'Response' : `Response${code}`;
          resp.type = promoteRef(resp.type, `${opPascal}${suffix}`);
        }
      }

      // Promote parameter inline types
      const promoteParams = (params: IRParameter[], prefix: string) => {
        for (const param of params) {
          if (param.type.inline && (param.type.inline.kind === 'object' || param.type.inline.kind === 'enum')) {
            param.type = promoteRef(param.type, `${opPascal}${toPascalCase(param.name)}${prefix}`);
          }
        }
      };
      promoteParams(ep.pathParams, 'Param');
      promoteParams(ep.queryParams, 'Query');
      promoteParams(ep.headerParams, 'Header');
    }

    if (this.schema.events) {
      for (const event of this.schema.events) {
        const evPascal = toPascalCase(event.name);
        if (event.payload?.inline) {
          event.payload = promoteRef(event.payload, `${evPascal}Payload`);
        }
        if (event.ackPayload?.inline) {
          event.ackPayload = promoteRef(event.ackPayload, `${evPascal}AckPayload`);
        }
        if (event.headers) {
          for (const header of event.headers) {
            if (header.type.inline && (header.type.inline.kind === 'object' || header.type.inline.kind === 'enum')) {
              header.type = promoteRef(header.type, `${evPascal}${toPascalCase(header.name)}Header`);
            }
          }
        }
      }
    }

    if (promoted > 0) {
      this.diagnostics.push({
        severity: 'info',
        code: 'PROMOTE_ANONYMOUS',
        message: `Promoted ${promoted} anonymous inline types to named types.`,
      });
    }
  }

  // ─── Inline Trivial Types ────────────────────────────────────────

  /**
   * Find named scalar types (like `type MyString = string`) without format or
   * constraints, and inline them wherever they are referenced. Then remove
   * the named type.
   */
  private inlineTrivialTypes(): void {
    const toInline = new Map<string, IRType>();

    for (const [id, type] of this.schema.types) {
      if (type.kind === 'scalar' && !type.format && !type.constraints) {
        toInline.set(id, type);
      }
    }

    if (toInline.size === 0) return;

    // Traverse all type refs and replace refs to inlined types
    const replaceRef = (ref: IRTypeRef): IRTypeRef => {
      if (ref.ref && toInline.has(ref.ref)) {
        const inlinedType = toInline.get(ref.ref)!;
        return {
          inline: inlinedType,
          nullable: ref.nullable,
          isArray: ref.isArray,
          defaultValue: ref.defaultValue,
        };
      }
      return ref;
    };

    // Replace in all types
    for (const [, type] of this.schema.types) {
      this.walkTypeRefs(type, replaceRef);
    }

    // Replace in all endpoints
    for (const ep of this.schema.endpoints) {
      this.walkEndpointRefs(ep, replaceRef);
    }

    // Replace in all events
    if (this.schema.events) {
      for (const event of this.schema.events) {
        this.walkEventRefs(event, replaceRef);
      }
    }

    // Remove inlined types from the registry
    for (const id of toInline.keys()) {
      this.schema.types.delete(id);
    }

    this.diagnostics.push({
      severity: 'info',
      code: 'INLINE_TYPES',
      message: `Inlined ${toInline.size} trivial scalar types.`,
    });
  }

  // ─── Deduplicate Types ────────────────────────────────────────────

  /**
   * Find structurally identical types using SHA-256 of their canonical JSON
   * representation. Merge duplicates: keep the first, rewrite refs to the rest.
   */
  private deduplicateTypes(): void {
    const hashMap = new Map<string, string>(); // hash → canonical type ID
    const mergeMap = new Map<string, string>(); // duplicate ID → canonical ID

    for (const [id, type] of this.schema.types) {
      const hash = this.canonicalHash(type);
      const existing = hashMap.get(hash);
      if (existing && existing !== id) {
        mergeMap.set(id, existing);
      } else {
        hashMap.set(hash, id);
      }
    }

    if (mergeMap.size === 0) return;

    // Rewrite refs
    const replaceRef = (ref: IRTypeRef): IRTypeRef => {
      if (ref.ref && mergeMap.has(ref.ref)) {
        return { ...ref, ref: mergeMap.get(ref.ref) };
      }
      return ref;
    };

    for (const [, type] of this.schema.types) {
      this.walkTypeRefs(type, replaceRef);
    }
    for (const ep of this.schema.endpoints) {
      this.walkEndpointRefs(ep, replaceRef);
    }
    if (this.schema.events) {
      for (const event of this.schema.events) {
        this.walkEventRefs(event, replaceRef);
      }
    }

    // Remove duplicates
    for (const id of mergeMap.keys()) {
      this.schema.types.delete(id);
    }

    this.diagnostics.push({
      severity: 'info',
      code: 'DEDUPLICATE_TYPES',
      message: `Merged ${mergeMap.size} structurally identical types.`,
    });
  }

  // ─── Normalize Naming ─────────────────────────────────────────────

  /**
   * Normalize naming conventions:
   *   - Type IDs → PascalCase
   *   - Field names → camelCase
   *   - Operation IDs → camelCase
   */
  private normalizeNaming(): void {
    const renames = new Map<string, string>();

    // Normalize type IDs to PascalCase
    for (const [id, type] of this.schema.types) {
      const pascal = toPascalCase(id);
      if (pascal !== id && !this.schema.types.has(pascal)) {
        renames.set(id, pascal);
      }
    }

    if (renames.size > 0) {
      // Apply renames
      for (const [oldId, newId] of renames) {
        const type = this.schema.types.get(oldId)!;
        this.schema.types.delete(oldId);
        type.id = newId;
        this.schema.types.set(newId, type);
      }

      // Rewrite refs
      const replaceRef = (ref: IRTypeRef): IRTypeRef => {
        if (ref.ref && renames.has(ref.ref)) {
          return { ...ref, ref: renames.get(ref.ref) };
        }
        return ref;
      };

      for (const [, type] of this.schema.types) {
        this.walkTypeRefs(type, replaceRef);
      }
      for (const ep of this.schema.endpoints) {
        this.walkEndpointRefs(ep, replaceRef);
      }
      if (this.schema.events) {
        for (const event of this.schema.events) {
          this.walkEventRefs(event, replaceRef);
        }
      }
    }

    // Normalize field names to camelCase (within object types)
    for (const [, type] of this.schema.types) {
      if (type.kind === 'object') {
        for (const field of type.fields) {
          field.name = toCamelCase(field.name);
        }
      }
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────

  /** Walk all type refs within a type definition and apply a transform. */
  private walkTypeRefs(type: IRType, transform: (ref: IRTypeRef) => IRTypeRef): void {
    switch (type.kind) {
      case 'object':
        for (const field of type.fields) {
          field.type = transform(field.type);
          if (field.type.inline) this.walkTypeRefs(field.type.inline, transform);
        }
        if (typeof type.additionalProperties === 'object' && 'ref' in type.additionalProperties) {
          type.additionalProperties = transform(type.additionalProperties as IRTypeRef);
        }
        break;
      case 'array':
        type.items = transform(type.items);
        if (type.items.inline) this.walkTypeRefs(type.items.inline, transform);
        break;
      case 'union':
        type.members = type.members.map(transform);
        break;
      case 'intersection':
        type.members = type.members.map(transform);
        break;
      case 'map':
        type.valueType = transform(type.valueType);
        break;
      case 'tuple':
        type.elements = type.elements.map(transform);
        break;
      case 'generic':
        type.baseType = transform(type.baseType);
        for (const tp of type.typeParameters) {
          if (tp.constraint) tp.constraint = transform(tp.constraint);
          if (tp.defaultType) tp.defaultType = transform(tp.defaultType);
        }
        break;
    }
  }

  /** Walk all type refs within an endpoint and apply a transform. */
  private walkEndpointRefs(ep: IREndpoint, transform: (ref: IRTypeRef) => IRTypeRef): void {
    for (const p of ep.pathParams) p.type = transform(p.type);
    for (const p of ep.queryParams) p.type = transform(p.type);
    for (const p of ep.headerParams) p.type = transform(p.type);
    if (ep.requestBody) ep.requestBody.type = transform(ep.requestBody.type);
    for (const resp of Object.values(ep.responses)) {
      if (resp.type) resp.type = transform(resp.type);
    }
    // Streaming contract refs
    if (ep.streaming?.itemType) ep.streaming.itemType = transform(ep.streaming.itemType);
    if (ep.streaming?.eventTypes) {
      for (const [evt, ref] of Object.entries(ep.streaming.eventTypes)) {
        ep.streaming.eventTypes[evt] = transform(ref);
      }
    }
  }

  /** Walk all type refs within an event and apply a transform. */
  private walkEventRefs(event: IREventContract, transform: (ref: IRTypeRef) => IRTypeRef): void {
    if (event.payload) {
      event.payload = transform(event.payload);
      if (event.payload.inline) this.walkTypeRefs(event.payload.inline, transform);
    }
    if (event.ackPayload) {
      event.ackPayload = transform(event.ackPayload);
      if (event.ackPayload.inline) this.walkTypeRefs(event.ackPayload.inline, transform);
    }
    if (event.headers) {
      for (const h of event.headers) {
        h.type = transform(h.type);
        if (h.type.inline) this.walkTypeRefs(h.type.inline, transform);
      }
    }
  }

  /**
   * Compute a canonical hash for a type, ignoring `id` and `description`
   * so that structurally identical types with different names are merged.
   */
  private canonicalHash(type: IRType): string {
    const { id: _id, description: _desc, metadata: _meta, lineage: _lin, ...canonical } = type;
    const str = JSON.stringify(canonical, (key, value) => {
      if (value instanceof Map) {
        return Object.fromEntries([...value.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      }
      if (value instanceof Set) return [...value].sort();
      return value;
    });
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /** Generate a unique type name that doesn't collide with existing types. */
  private ensureUniqueName(baseName: string): string {
    if (!this.schema.types.has(baseName)) return baseName;
    let i = 2;
    while (this.schema.types.has(`${baseName}${i}`)) i++;
    return `${baseName}${i}`;
  }
}

// ─── Naming Helpers ──────────────────────────────────────────────────────────

/** Convert a string to PascalCase. */
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

/** Convert a string to camelCase. */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
