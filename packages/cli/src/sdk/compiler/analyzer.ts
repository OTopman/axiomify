/**
 * Semantic Analyzer.
 *
 * Phase 2 of the compiler pipeline. Performs deep semantic validation:
 *   - Broken type references (dangling refs)
 *   - Recursive inline type checking (nested objects, arrays, unions)
 *   - Discriminator mapping validation
 *   - Security scheme reference validation
 *   - Recursive schema depth bomb detection
 *   - Regex DoS pattern detection (ReDoS)
 *   - Payload size estimation (unbounded arrays/maps)
 *   - Missing/duplicate operation IDs
 *   - Empty endpoint responses
 *   - Event contract validation
 */
import type {
  IRSchema,
  IRType,
  IRTypeRef,
  IRDiagnostic,
  IRObjectType,
  IREndpoint,
  IREventContract,
} from '../ir/types';

/** Maximum allowed schema nesting depth (prevents stack overflow bombs). */
const MAX_SCHEMA_DEPTH = 64;

/** Patterns that indicate a potential ReDoS vulnerability. */
const REDOS_PATTERNS = [
  /(\(.*\+\))\1/,  // Nested quantifiers
  /\(.*\|.*\)\+/,  // Alternation with quantifier
  /\(.*\)\{.+\}\{.+\}/,  // Multiple bounded quantifiers
];

export class Analyzer {
  private schema!: IRSchema;
  private diagnostics!: IRDiagnostic[];

  analyze(schema: IRSchema, diagnostics: IRDiagnostic[]): void {
    this.schema = schema;
    this.diagnostics = diagnostics;

    this.checkReferences();
    this.checkEndpoints();
    this.checkDiscriminators();
    this.checkSecuritySchemes();
    this.checkSchemaDepth();
    this.checkConstraints();
    this.checkPayloadBounds();
    this.checkEventContracts();
  }

  // ─── Reference Checking ───────────────────────────────────────────

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
        this.checkType(ref.inline, ctx, 0);
      }
      if (ref.typeArguments) {
        for (let i = 0; i < ref.typeArguments.length; i++) {
          checkRef(ref.typeArguments[i], `${ctx} type argument ${i}`);
        }
      }
    };

    for (const [id, type] of this.schema.types) {
      this.checkType(type, `type ${id}`, 0);
    }

    for (const ep of this.schema.endpoints) {
      const ctx = `endpoint ${ep.operationId}`;
      for (const p of ep.pathParams || []) checkRef(p.type, `${ctx} path param ${p.name}`);
      for (const p of ep.queryParams || []) checkRef(p.type, `${ctx} query param ${p.name}`);
      for (const p of ep.headerParams || []) checkRef(p.type, `${ctx} header param ${p.name}`);
      if (ep.requestBody) checkRef(ep.requestBody.type, `${ctx} request body`);
      for (const [sc, resp] of Object.entries(ep.responses || {})) {
        checkRef(resp.type, `${ctx} response ${sc}`);
      }
      // Streaming contract refs
      if (ep.streaming?.itemType) checkRef(ep.streaming.itemType, `${ctx} streaming item`);
      if (ep.streaming?.eventTypes) {
        for (const [evt, ref] of Object.entries(ep.streaming.eventTypes)) {
          checkRef(ref, `${ctx} streaming event ${evt}`);
        }
      }
    }
  }

  /** Recursively check an IR type node for validity. */
  private checkType(type: IRType, ctx: string, depth: number): void {
    if (depth > MAX_SCHEMA_DEPTH) {
      this.diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_DEPTH_BOMB',
        message: `Schema nesting depth exceeds ${MAX_SCHEMA_DEPTH} at ${ctx}. This may cause stack overflow during generation.`,
      });
      return;
    }

    switch (type.kind) {
      case 'object':
        for (const field of type.fields) {
          this.checkFieldRef(field.type, `${ctx}.${field.name}`, depth + 1);
          // Check for fields with same name (case-insensitive)
          const lowerNames = type.fields.map((f) => f.name.toLowerCase());
          const seen = new Set<string>();
          for (const ln of lowerNames) {
            if (seen.has(ln)) {
              this.diagnostics.push({
                severity: 'warning',
                code: 'CASE_COLLISION',
                message: `Field name "${ln}" in ${ctx} may cause case-sensitivity issues in some languages.`,
              });
              break;
            }
            seen.add(ln);
          }
        }
        if (typeof type.additionalProperties === 'object' && 'ref' in type.additionalProperties) {
          this.checkFieldRef(type.additionalProperties as IRTypeRef, `${ctx}.additionalProperties`, depth + 1);
        }
        break;

      case 'array':
        this.checkFieldRef(type.items, `${ctx}[]`, depth + 1);
        break;

      case 'union':
        if (type.members.length === 0) {
          this.diagnostics.push({
            severity: 'warning',
            code: 'EMPTY_UNION',
            message: `Union type "${type.id}" has no members in ${ctx}.`,
          });
        }
        for (let i = 0; i < type.members.length; i++) {
          this.checkFieldRef(type.members[i], `${ctx}[${i}]`, depth + 1);
        }
        break;

      case 'intersection':
        if (type.members.length === 0) {
          this.diagnostics.push({
            severity: 'warning',
            code: 'EMPTY_INTERSECTION',
            message: `Intersection type "${type.id}" has no members in ${ctx}.`,
          });
        }
        for (let i = 0; i < type.members.length; i++) {
          this.checkFieldRef(type.members[i], `${ctx}[${i}]`, depth + 1);
        }
        break;

      case 'map':
        this.checkFieldRef(type.valueType, `${ctx}[value]`, depth + 1);
        break;

      case 'tuple':
        for (let i = 0; i < type.elements.length; i++) {
          this.checkFieldRef(type.elements[i], `${ctx}[${i}]`, depth + 1);
        }
        break;

      case 'generic':
        this.checkFieldRef(type.baseType, `${ctx}.base`, depth + 1);
        for (const tp of type.typeParameters) {
          if (tp.constraint) this.checkFieldRef(tp.constraint, `${ctx}.${tp.name}.constraint`, depth + 1);
          if (tp.defaultType) this.checkFieldRef(tp.defaultType, `${ctx}.${tp.name}.default`, depth + 1);
        }
        break;

      case 'enum':
        if (type.values.length === 0) {
          this.diagnostics.push({
            severity: 'warning',
            code: 'EMPTY_ENUM',
            message: `Enum type "${type.id}" has no values in ${ctx}.`,
          });
        }
        break;

      case 'scalar':
      case 'literal':
        break;
    }
  }

  /** Check a type ref, recursing into inline types. */
  private checkFieldRef(ref: IRTypeRef, ctx: string, depth: number): void {
    if (ref.ref && !this.schema.types.has(ref.ref)) {
      this.diagnostics.push({
        severity: 'error',
        code: 'BROKEN_REFERENCE',
        message: `Broken type reference "${ref.ref}" in ${ctx}`,
      });
    }
    if (ref.inline) {
      this.checkType(ref.inline, ctx, depth);
    }
  }

  // ─── Endpoint Checking ────────────────────────────────────────────

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

      // Warn on endpoints with no responses
      if (Object.keys(ep.responses || {}).length === 0 && ep.transport === 'rest') {
        this.diagnostics.push({
          severity: 'warning',
          code: 'NO_RESPONSES',
          message: `Endpoint "${ep.operationId}" has no response definitions.`,
        });
      }

      // Warn on endpoints with no success response
      if (ep.transport === 'rest' && Object.keys(ep.responses || {}).length > 0) {
        const hasSuccess = Object.keys(ep.responses || {}).some((c) => c.startsWith('2'));
        if (!hasSuccess) {
          this.diagnostics.push({
            severity: 'warning',
            code: 'NO_SUCCESS_RESPONSE',
            message: `Endpoint "${ep.operationId}" has no 2xx response defined.`,
          });
        }
      }

      // Check path params match route pattern
      if (ep.path) {
        const pathParamNames = [...ep.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
        const declaredParams = new Set((ep.pathParams || []).map((p) => p.name));
        for (const name of pathParamNames) {
          if (!declaredParams.has(name)) {
            this.diagnostics.push({
              severity: 'warning',
              code: 'UNDECLARED_PATH_PARAM',
              message: `Path parameter "{${name}}" in "${ep.path}" is not declared in endpoint "${ep.operationId}".`,
            });
          }
        }
      }
    }
  }

  // ─── Discriminator Validation ─────────────────────────────────────

  private checkDiscriminators(): void {
    for (const [id, type] of this.schema.types) {
      if (type.kind === 'object' && type.discriminator) {
        const disc = type.discriminator;
        // Ensure discriminator property exists in the type's fields
        const hasField = type.fields.some((f) => f.name === disc.propertyName);
        if (!hasField) {
          this.diagnostics.push({
            severity: 'error',
            code: 'INVALID_DISCRIMINATOR',
            message: `Discriminator property "${disc.propertyName}" does not exist on type "${id}".`,
          });
        }

        // Validate mapping targets
        if (disc.mapping) {
          for (const [val, targetType] of Object.entries(disc.mapping)) {
            if (!this.schema.types.has(targetType)) {
              this.diagnostics.push({
                severity: 'error',
                code: 'INVALID_DISCRIMINATOR_MAPPING',
                message: `Discriminator mapping "${val}" → "${targetType}" in type "${id}" references a non-existent type.`,
              });
            }
          }
        }
      }

      if (type.kind === 'union' && type.discriminator) {
        const disc = type.discriminator;
        // Validate each member has the discriminator property
        for (const member of type.members) {
          const resolved = member.ref ? this.schema.types.get(member.ref) : member.inline;
          if (resolved?.kind === 'object') {
            const hasField = resolved.fields.some((f) => f.name === disc.propertyName);
            if (!hasField) {
              this.diagnostics.push({
                severity: 'warning',
                code: 'DISCRIMINATOR_MISSING_FIELD',
                message: `Union member "${resolved.id}" is missing discriminator property "${disc.propertyName}" from union "${id}".`,
              });
            }
          }
        }
      }
    }
  }

  // ─── Security Scheme Validation ───────────────────────────────────

  private checkSecuritySchemes(): void {
    for (const ep of this.schema.endpoints) {
      for (const req of ep.security || []) {
        if (!this.schema.securitySchemes.has(req.schemeName)) {
          this.diagnostics.push({
            severity: 'error',
            code: 'MISSING_SECURITY_SCHEME',
            message: `Endpoint "${ep.operationId}" references security scheme "${req.schemeName}" which is not defined.`,
          });
        }
      }
    }

    for (const req of this.schema.globalSecurity || []) {
      if (!this.schema.securitySchemes.has(req.schemeName)) {
        this.diagnostics.push({
          severity: 'error',
          code: 'MISSING_GLOBAL_SECURITY_SCHEME',
          message: `Global security references scheme "${req.schemeName}" which is not defined.`,
        });
      }
    }
  }

  // ─── Schema Depth Check ───────────────────────────────────────────

  /** Check for excessively deep schemas that could cause generation issues. */
  private checkSchemaDepth(): void {
    for (const [id] of this.schema.types) {
      this.measureDepth(id, new Set(), 0);
    }
  }

  private measureDepth(typeId: string, visited: Set<string>, depth: number): void {
    if (depth > MAX_SCHEMA_DEPTH) {
      this.diagnostics.push({
        severity: 'error',
        code: 'SCHEMA_DEPTH_BOMB',
        message: `Type "${typeId}" exceeds maximum nesting depth of ${MAX_SCHEMA_DEPTH}. Consider restructuring.`,
      });
      return;
    }
    if (visited.has(typeId)) return;
    visited.add(typeId);

    const type = this.schema.types.get(typeId);
    if (!type) return;

    const refs = this.extractDirectRefs(type);
    for (const ref of refs) {
      if (ref) this.measureDepth(ref, visited, depth + 1);
    }
  }

  // ─── Constraint Validation ────────────────────────────────────────

  /** Check regex patterns for potential ReDoS vulnerabilities. */
  private checkConstraints(): void {
    for (const [id, type] of this.schema.types) {
      if (type.kind === 'object') {
        for (const field of type.fields) {
          if (field.constraints?.pattern) {
            this.checkRegexSafety(field.constraints.pattern, `${id}.${field.name}`);
          }
        }
      }
      if (type.kind === 'scalar' && type.constraints?.pattern) {
        this.checkRegexSafety(type.constraints.pattern, id);
      }
    }
  }

  private checkRegexSafety(pattern: string, ctx: string): void {
    for (const redos of REDOS_PATTERNS) {
      if (redos.test(pattern)) {
        this.diagnostics.push({
          severity: 'warning',
          code: 'POTENTIAL_REDOS',
          message: `Pattern "${pattern}" in ${ctx} may be vulnerable to ReDoS attacks.`,
        });
        return;
      }
    }
  }

  // ─── Payload Bounds ───────────────────────────────────────────────

  /** Warn about unbounded arrays or maps that could lead to memory issues. */
  private checkPayloadBounds(): void {
    for (const [id, type] of this.schema.types) {
      if (type.kind === 'array' && !type.maxItems) {
        this.diagnostics.push({
          severity: 'info',
          code: 'UNBOUNDED_ARRAY',
          message: `Array type "${id}" has no maxItems constraint. Consider adding one for safety.`,
        });
      }
      if (type.kind === 'map') {
        this.diagnostics.push({
          severity: 'info',
          code: 'UNBOUNDED_MAP',
          message: `Map type "${id}" has no size constraint. Consider documenting expected bounds.`,
        });
      }
    }
  }

  // ─── Event Contract Validation ────────────────────────────────────

  private checkEventContracts(): void {
    if (!this.schema.events) return;
    const seenNames = new Set<string>();
    for (const event of this.schema.events) {
      if (!event.name) {
        this.diagnostics.push({
          severity: 'error',
          code: 'MISSING_EVENT_NAME',
          message: `Event contract is missing a name.`,
        });
      }
      if (seenNames.has(event.name)) {
        this.diagnostics.push({
          severity: 'error',
          code: 'DUPLICATE_EVENT_NAME',
          message: `Duplicate event name "${event.name}".`,
        });
      }
      seenNames.add(event.name);

      if (event.payload?.ref && !this.schema.types.has(event.payload.ref)) {
        this.diagnostics.push({
          severity: 'error',
          code: 'BROKEN_EVENT_PAYLOAD_REF',
          message: `Event "${event.name}" references payload type "${event.payload.ref}" which does not exist.`,
        });
      }
      if (event.ackPayload?.ref && !this.schema.types.has(event.ackPayload.ref)) {
        this.diagnostics.push({
          severity: 'error',
          code: 'BROKEN_EVENT_ACK_REF',
          message: `Event "${event.name}" references ack payload type "${event.ackPayload.ref}" which does not exist.`,
        });
      }
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────

  private extractDirectRefs(type: IRType): (string | undefined)[] {
    const refs: (string | undefined)[] = [];
    switch (type.kind) {
      case 'object':
        for (const f of type.fields) refs.push(f.type.ref);
        break;
      case 'array':
        refs.push(type.items.ref);
        break;
      case 'union':
      case 'intersection':
        for (const m of type.members) refs.push(m.ref);
        break;
      case 'map':
        refs.push(type.valueType.ref);
        break;
      case 'tuple':
        for (const el of type.elements) refs.push(el.ref);
        break;
      case 'generic':
        refs.push(type.baseType.ref);
        break;
    }
    return refs.filter(Boolean);
  }
}
