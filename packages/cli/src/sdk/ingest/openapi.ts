/**
 * OpenAPI 3.0/3.1 ingestion engine.
 *
 * Parses an OpenAPI spec (JSON or YAML object) and transforms it into
 * the language-agnostic IR. Handles $ref resolution (with cycle guard),
 * allOf/oneOf/anyOf composition, discriminators, parameters, security
 * schemes, and per-status-code response types.
 */
import type {
  IRSchema,
  IRType,
  IRObjectType,
  IRArrayType,
  IREnumType,
  IRUnionType,
  IRIntersectionType,
  IRScalarType,
  IRField,
  IRTypeRef,
  IREndpoint,
  IRParameter,
  IRRequestBody,
  IRResponse,
  IRSecurityRequirement,
  IRSecurityScheme,
  IRServer,
  IRHttpMethod,
  IRContentType,
  IRDiagnostic,
  IRScalar,
  IRConstraints,
} from '../ir/types';

// ─── OpenAPI JSON shapes (minimal, spec-aligned) ─────────────────────────────

interface OASpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths?: Record<string, Record<string, OAOperation>>;
  components?: {
    schemas?: Record<string, OASchema>;
    securitySchemes?: Record<string, OASecScheme>;
  };
  servers?: OAServer[];
  security?: Array<Record<string, string[]>>;
}
interface OAOperation {
  operationId?: string; summary?: string; description?: string;
  tags?: string[]; deprecated?: boolean;
  parameters?: OAParam[]; requestBody?: OAReqBody;
  responses?: Record<string, OAResp>;
  security?: Array<Record<string, string[]>>;
}
interface OAParam {
  name: string; in: string; required?: boolean; description?: string;
  deprecated?: boolean; schema?: OASchema; style?: string;
  explode?: boolean; example?: unknown;
}
interface OAReqBody {
  description?: string; required?: boolean;
  content?: Record<string, { schema?: OASchema }>;
}
interface OAResp {
  description?: string;
  content?: Record<string, { schema?: OASchema }>;
  headers?: Record<string, { schema?: OASchema; description?: string }>;
}
interface OASchema {
  $ref?: string; type?: string | string[]; format?: string;
  description?: string; deprecated?: boolean;
  properties?: Record<string, OASchema>; required?: string[];
  items?: OASchema; enum?: (string | number)[];
  allOf?: OASchema[]; oneOf?: OASchema[]; anyOf?: OASchema[];
  additionalProperties?: boolean | OASchema;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  nullable?: boolean; readOnly?: boolean; writeOnly?: boolean;
  default?: unknown; example?: unknown; title?: string;
  minLength?: number; maxLength?: number; pattern?: string;
  minimum?: number; maximum?: number;
  exclusiveMinimum?: number; exclusiveMaximum?: number;
  multipleOf?: number; minItems?: number; maxItems?: number;
  uniqueItems?: boolean;
}
interface OASecScheme {
  type: string; description?: string; name?: string; in?: string;
  scheme?: string; bearerFormat?: string; flows?: Record<string, unknown>;
}
interface OAServer {
  url: string; description?: string;
  variables?: Record<string, { default: string; enum?: string[]; description?: string }>;
}

const MAX_REF_DEPTH = 64;

export interface OpenApiIngestOptions {
  title?: string;
  version?: string;
}

export function ingestOpenApi(
  spec: Record<string, unknown>,
  options: OpenApiIngestOptions = {},
): { schema: IRSchema; diagnostics: IRDiagnostic[] } {
  const oa = spec as unknown as OASpec;
  const diagnostics: IRDiagnostic[] = [];
  const types = new Map<string, IRType>();
  const securitySchemes = new Map<string, IRSecurityScheme>();
  const endpoints: IREndpoint[] = [];
  const refStack = new Set<string>();
  let anonCounter = 0;

  // ─── $ref resolution ──────────────────────────────────────────────

  function resolveRef(schema: OASchema, depth = 0): OASchema {
    if (depth > MAX_REF_DEPTH) {
      diagnostics.push({ severity: 'error', code: 'REF_DEPTH_EXCEEDED',
        message: `$ref resolution exceeded max depth (${MAX_REF_DEPTH})` });
      return { type: 'object' };
    }
    if (!schema.$ref) return schema;
    const ref = schema.$ref;
    if (refStack.has(ref)) return schema;
    refStack.add(ref);
    try {
      const resolved = resolveJsonPointer(oa as unknown as Record<string, unknown>, ref);
      if (!resolved) {
        diagnostics.push({ severity: 'warning', code: 'UNRESOLVED_REF',
          message: `Cannot resolve $ref: ${ref}`, location: ref });
        return { type: 'object' };
      }
      return resolveRef(resolved as OASchema, depth + 1);
    } finally { refStack.delete(ref); }
  }

  function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
    const path = pointer.replace(/^#\//, '').split('/')
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur: unknown = root;
    for (const seg of path) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
  }

  function refToTypeName(ref: string): string {
    return ref.split('/').pop()!;
  }

  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function synthesiseOperationId(method: string, path: string): string {
    const verb = method.toLowerCase();
    const parts: string[] = [];
    for (const seg of path.split('/')) {
      if (!seg) continue;
      if (seg.startsWith('{') && seg.endsWith('}')) {
        parts.push('By', capitalize(seg.slice(1, -1)));
      } else if (seg === '*') { parts.push('All'); }
      else { parts.push(capitalize(seg)); }
    }
    return verb + parts.join('');
  }

  // ─── Schema → TypeRef ─────────────────────────────────────────────

  function schemaToTypeRef(schema: OASchema, ctx?: string): IRTypeRef {
    if (schema.$ref) {
      return { ref: refToTypeName(schema.$ref), nullable: schema.nullable };
    }
    const t = schemaToType(schema, ctx);
    if (t && types.has(t.id) && t.id !== ctx) return { ref: t.id, nullable: schema.nullable };
    return { inline: t ?? { id: '_unknown', kind: 'scalar', scalar: 'any' }, nullable: schema.nullable };
  }

  // ─── Schema → IRType ──────────────────────────────────────────────

  function schemaToType(raw: OASchema, ctx?: string): IRType | undefined {
    const s = resolveRef(raw);

    if (s.allOf?.length) {
      const name = ctx ?? `Intersection${++anonCounter}`;
      return { id: name, kind: 'intersection',
        members: s.allOf.map((x, i) => schemaToTypeRef(x, `${name}_AllOf${i}`)),
        description: s.description, deprecated: s.deprecated } as IRIntersectionType;
    }
    if (s.oneOf?.length) {
      const name = ctx ?? `Union${++anonCounter}`;
      return { id: name, kind: 'union',
        members: s.oneOf.map((x, i) => schemaToTypeRef(x, `${name}_OneOf${i}`)),
        description: s.description, deprecated: s.deprecated,
        discriminator: s.discriminator ? {
          propertyName: s.discriminator.propertyName,
          mapping: s.discriminator.mapping ?? {},
        } : undefined } as IRUnionType;
    }
    if (s.anyOf?.length) {
      const name = ctx ?? `Union${++anonCounter}`;
      return { id: name, kind: 'union',
        members: s.anyOf.map((x, i) => schemaToTypeRef(x, `${name}_AnyOf${i}`)),
        description: s.description } as IRUnionType;
    }
    if (s.enum?.length) {
      const name = ctx ?? `Enum${++anonCounter}`;
      const vt = typeof s.enum[0] === 'number' ? 'number' as const : 'string' as const;
      return { id: name, kind: 'enum', valueType: vt,
        values: s.enum.map((v) => ({ name: String(v), value: v as string | number })),
        description: s.description, deprecated: s.deprecated } as IREnumType;
    }

    const st = Array.isArray(s.type) ? s.type[0] : s.type;

    if (st === 'object' || s.properties) {
      const name = ctx ?? `Object${++anonCounter}`;
      const reqSet = new Set(s.required ?? []);
      const fields: IRField[] = Object.entries(s.properties ?? {}).map(([pn, ps]) => {
        const rs = resolveRef(ps);
        const constraints = extractConstraints(rs);
        return {
          name: pn, type: schemaToTypeRef(rs, `${name}_${capitalize(pn)}`),
          required: reqSet.has(pn), description: rs.description,
          deprecated: rs.deprecated, readOnly: rs.readOnly, writeOnly: rs.writeOnly,
          example: rs.example,
          constraints: Object.keys(constraints).length ? constraints : undefined,
        };
      });
      let ap: IRTypeRef | boolean | undefined;
      if (s.additionalProperties !== undefined) {
        ap = typeof s.additionalProperties === 'boolean'
          ? s.additionalProperties
          : schemaToTypeRef(s.additionalProperties, `${name}_AdditionalProps`);
      }
      return { id: name, kind: 'object', fields, description: s.description,
        deprecated: s.deprecated, additionalProperties: ap,
        discriminator: s.discriminator ? {
          propertyName: s.discriminator.propertyName,
          mapping: s.discriminator.mapping,
        } : undefined } as IRObjectType;
    }

    if (st === 'array') {
      const name = ctx ?? `Array${++anonCounter}`;
      const items = s.items
        ? schemaToTypeRef(s.items, `${name}_Item`)
        : { inline: { id: '_any', kind: 'scalar' as const, scalar: 'any' as const } };
      return { id: name, kind: 'array', items, description: s.description,
        minItems: s.minItems, maxItems: s.maxItems, uniqueItems: s.uniqueItems } as IRArrayType;
    }

    if (st) {
      const name = ctx ?? `Scalar${++anonCounter}`;
      const scalar = mapScalar(st, s.format);
      const constraints = extractConstraints(s);
      return { id: name, kind: 'scalar', scalar, format: s.format,
        description: s.description, deprecated: s.deprecated,
        constraints: Object.keys(constraints).length ? constraints : undefined } as IRScalarType;
    }

    return { id: ctx ?? `Unknown${++anonCounter}`, kind: 'scalar', scalar: 'any' };
  }

  function mapScalar(type: string, format?: string): IRScalar {
    switch (type) {
      case 'string':
        switch (format) {
          case 'date': return 'date';
          case 'date-time': return 'datetime';
          case 'uuid': return 'uuid';
          case 'uri': return 'uri';
          case 'email': return 'email';
          case 'binary': case 'byte': return 'binary';
          default: return 'string';
        }
      case 'number': case 'float': case 'double': return 'number';
      case 'integer': return format === 'int64' ? 'bigint' : 'integer';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      default: return 'any';
    }
  }

  function extractConstraints(s: OASchema): IRConstraints {
    const c: IRConstraints = {};
    if (s.minLength !== undefined) c.minLength = s.minLength;
    if (s.maxLength !== undefined) c.maxLength = s.maxLength;
    if (s.pattern !== undefined) c.pattern = s.pattern;
    if (s.minimum !== undefined) c.minimum = s.minimum;
    if (s.maximum !== undefined) c.maximum = s.maximum;
    if (s.exclusiveMinimum !== undefined) c.exclusiveMinimum = s.exclusiveMinimum;
    if (s.exclusiveMaximum !== undefined) c.exclusiveMaximum = s.exclusiveMaximum;
    if (s.multipleOf !== undefined) c.multipleOf = s.multipleOf;
    return c;
  }

  // ─── Phase 1: component schemas ────────────────────────────────────

  for (const [name, schema] of Object.entries(oa.components?.schemas ?? {})) {
    const t = schemaToType(schema, name);
    if (t) types.set(name, t);
  }

  // ─── Phase 2: security schemes ─────────────────────────────────────

  for (const [name, scheme] of Object.entries(oa.components?.securitySchemes ?? {})) {
    securitySchemes.set(name, {
      name, type: scheme.type as IRSecurityScheme['type'],
      description: scheme.description, in: scheme.in as IRSecurityScheme['in'],
      parameterName: scheme.name, scheme: scheme.scheme,
      bearerFormat: scheme.bearerFormat, flows: scheme.flows,
    });
  }

  // ─── Phase 3: paths → endpoints ────────────────────────────────────

  const seenOps = new Set<string>();
  for (const [path, pathItem] of Object.entries(oa.paths ?? {})) {
    for (const method of ['get','post','put','patch','delete','options','head'] as const) {
      const op = pathItem[method] as OAOperation | undefined;
      if (!op) continue;

      let opId = op.operationId ?? synthesiseOperationId(method, path);
      if (seenOps.has(opId)) {
        let i = 2;
        while (seenOps.has(`${opId}${i}`)) i++;
        diagnostics.push({ severity: 'warning', code: 'DUPLICATE_OPERATIONID',
          message: `Duplicate operationId "${op.operationId}" at ${method.toUpperCase()} ${path}, renamed to "${opId}${i}"`,
          location: `${method.toUpperCase()} ${path}` });
        opId = `${opId}${i}`;
      }
      seenOps.add(opId);

      const pathParams: IRParameter[] = [];
      const queryParams: IRParameter[] = [];
      const headerParams: IRParameter[] = [];
      for (const p of op.parameters ?? []) {
        const ps = p.schema ? resolveRef(p.schema) : { type: 'string' };
        const irP: IRParameter = {
          name: p.name, location: p.in as 'path' | 'query' | 'header',
          type: schemaToTypeRef(ps, `${opId}_${capitalize(p.name)}`),
          required: p.required ?? p.in === 'path',
          description: p.description, deprecated: p.deprecated,
          example: p.example, style: p.style, explode: p.explode,
        };
        if (p.in === 'path') pathParams.push(irP);
        else if (p.in === 'query') queryParams.push(irP);
        else if (p.in === 'header') headerParams.push(irP);
      }

      let requestBody: IRRequestBody | undefined;
      if (op.requestBody?.content) {
        const [ct, mt] = Object.entries(op.requestBody.content)[0] ?? [];
        if (ct && mt?.schema) {
          requestBody = {
            description: op.requestBody.description,
            required: op.requestBody.required ?? false,
            contentType: ct as IRContentType,
            type: schemaToTypeRef(resolveRef(mt.schema), `${opId}Request`),
          };
        }
      }

      const responses: Record<string, IRResponse> = {};
      let successResponse: string | undefined;
      for (const [sc, resp] of Object.entries(op.responses ?? {})) {
        const irR: IRResponse = { statusCode: sc, description: resp.description ?? `Response ${sc}` };
        if (resp.content) {
          const [ct, mt] = Object.entries(resp.content)[0] ?? [];
          if (ct && mt?.schema) {
            irR.contentType = ct as IRContentType;
            irR.type = schemaToTypeRef(resolveRef(mt.schema), `${opId}Response${sc}`);
          }
        }
        if (resp.headers) {
          irR.headers = Object.entries(resp.headers).map(([n, h]) => ({
            name: n, location: 'header' as const,
            type: h.schema ? schemaToTypeRef(resolveRef(h.schema))
              : { inline: { id: '_string', kind: 'scalar' as const, scalar: 'string' as const } },
            required: false, description: h.description,
          }));
        }
        responses[sc] = irR;
        if (!successResponse && sc.startsWith('2')) successResponse = sc;
      }

      const security: IRSecurityRequirement[] = [];
      for (const req of op.security ?? oa.security ?? []) {
        for (const [sn, scopes] of Object.entries(req)) {
          security.push({ schemeName: sn, scopes });
        }
      }

      endpoints.push({
        operationId: opId, summary: op.summary, description: op.description,
        tags: op.tags ?? [], deprecated: op.deprecated, transport: 'rest',
        method: method.toUpperCase() as IRHttpMethod, path,
        pathParams, queryParams, headerParams, requestBody,
        responses, successResponse, security,
      });
    }
  }

  // ─── Servers + global security ─────────────────────────────────────

  const servers: IRServer[] = (oa.servers ?? []).map((s) => ({
    url: s.url, description: s.description, variables: s.variables,
  }));
  const globalSecurity: IRSecurityRequirement[] = [];
  for (const req of oa.security ?? []) {
    for (const [sn, scopes] of Object.entries(req)) {
      globalSecurity.push({ schemeName: sn, scopes });
    }
  }

  return {
    schema: {
      info: {
        title: options.title ?? oa.info.title,
        version: options.version ?? oa.info.version,
        description: oa.info.description,
        sourceFormat: 'openapi', sourceVersion: oa.openapi,
      },
      types, endpoints, securitySchemes, servers, globalSecurity,
    },
    diagnostics,
  };
}
