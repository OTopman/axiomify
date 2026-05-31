/**
 * Axiomify app ingestion engine.
 *
 * Directly reads `app.registeredRoutes` and their Zod schemas to produce
 * an IR, bypassing the OpenAPI intermediate format. This provides the
 * tightest possible contract: what the framework validates at runtime
 * is exactly what the SDK types represent.
 *
 * Reuses the Zod→JSON Schema pattern from `@axiomify/openapi`.
 */
import type {
  IRArrayType,
  IRDiagnostic,
  IREndpoint,
  IREnumType,
  IRField,
  IRHttpMethod,
  IRObjectType,
  IRParameter,
  IRRequestBody,
  IRResponse,
  IRScalar,
  IRScalarType,
  IRSchema,
  IRType,
  IRTypeRef,
} from '../ir/types';

export interface AxiomifyAppIngestOptions {
  title?: string;
  version?: string;
}

/**
 * Zod schema → JSON Schema conversion (mirrors the approach in
 * packages/openapi/src/generator.ts).
 */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const s = schema as {
    toJSONSchema?: (opts?: Record<string, unknown>) => Record<string, unknown>;
  };
  if (typeof s?.toJSONSchema === 'function') {
    const full = s.toJSONSchema({ target: 'openApi3_1' });
    const { $schema: _, ...rest } = full;
    return rest;
  }
  // Zod v3 fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zodToJsonSchema: convert } = require('zod-to-json-schema');
    return convert(schema, { target: 'openApi3' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function synthesiseOperationId(method: string, path: string): string {
  const verb = method.toLowerCase();
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg) continue;

    // Convert path parameters to 'ByX' and wildcards to 'All'
    const normalized = seg.replace(/^:/, 'By-').replace(/\*/g, 'All');

    // Strip non-alphanumeric characters and camelCase the remaining words
    const cleanSeg = normalized
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map(capitalize)
      .join('');

    if (cleanSeg) parts.push(cleanSeg);
  }
  return verb + parts.join('');
}

let anonCounter = 0;

function jsonSchemaToIRType(js: Record<string, unknown>, ctx: string): IRType {
  const jsType = js.type as string | undefined;
  const jsEnum = js.enum as (string | number)[] | undefined;
  const jsProps = js.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const jsItems = js.items as Record<string, unknown> | undefined;
  const jsRequired = js.required as string[] | undefined;

  if (jsEnum?.length) {
    const vt =
      typeof jsEnum[0] === 'number' ? ('number' as const) : ('string' as const);
    return {
      id: ctx,
      kind: 'enum',
      valueType: vt,
      values: jsEnum.map((v) => ({
        name: String(v),
        value: v as string | number,
      })),
    } as IREnumType;
  }

  if (jsType === 'object' || jsProps) {
    const reqSet = new Set(jsRequired ?? []);
    const fields: IRField[] = Object.entries(jsProps ?? {}).map(
      ([name, prop]) => ({
        name,
        type: jsonSchemaToTypeRef(prop, `${ctx}_${capitalize(name)}`),
        required: reqSet.has(name),
        description: prop.description as string | undefined,
      }),
    );
    return { id: ctx, kind: 'object', fields } as IRObjectType;
  }

  if (jsType === 'array' && jsItems) {
    return {
      id: ctx,
      kind: 'array',
      items: jsonSchemaToTypeRef(jsItems, `${ctx}_Item`),
    } as IRArrayType;
  }

  const scalar = mapJsonSchemaScalar(
    jsType ?? 'any',
    js.format as string | undefined,
  );
  return {
    id: ctx,
    kind: 'scalar',
    scalar,
    format: js.format as string | undefined,
  } as IRScalarType;
}

function jsonSchemaToTypeRef(
  js: Record<string, unknown>,
  ctx: string,
): IRTypeRef {
  const t = jsonSchemaToIRType(js, ctx);
  return { inline: t };
}

function mapJsonSchemaScalar(type: string, format?: string): IRScalar {
  switch (type) {
    case 'string':
      switch (format) {
        case 'date':
          return 'date';
        case 'date-time':
          return 'datetime';
        case 'uuid':
          return 'uuid';
        case 'uri':
          return 'uri';
        case 'email':
          return 'email';
        case 'binary':
        case 'byte':
          return 'binary';
        default:
          return 'string';
      }
    case 'number':
      return 'number';
    case 'integer':
      return format === 'int64' ? 'bigint' : 'integer';
    case 'boolean':
      return 'boolean';
    default:
      return 'any';
  }
}

/**
 * Ingest an Axiomify app instance directly from its registered routes.
 * The `app` must have `.registeredRoutes` and optionally `.registeredWsRoutes`.
 */
function sanitizeIdentifier(str: string): string {
  const parts = str.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'operation';
  // First part lowercased, subsequent parts capitalized
  return parts[0] + parts.slice(1).map(capitalize).join('');
}

export function ingestAxiomifyApp(
  app: {
    registeredRoutes: readonly any[];
    registeredWsRoutes?: readonly any[];
  },
  options: AxiomifyAppIngestOptions = {},
): { schema: IRSchema; diagnostics: IRDiagnostic[] } {
  const diagnostics: IRDiagnostic[] = [];
  const types = new Map<string, IRType>();
  const endpoints: IREndpoint[] = [];
  const seenOps = new Set<string>();
  anonCounter = 0;

  for (const route of app.registeredRoutes || []) {
    const method: string = route.method ?? 'GET';
    const path: string = route.path ?? '/';
    const schema = route.schema ?? {};

    const rawOpId = schema.operationId ?? synthesiseOperationId(method, path);
    let opId = sanitizeIdentifier(rawOpId);

    if (seenOps.has(opId)) {
      let i = 2;
      while (seenOps.has(`${opId}${i}`)) i++;
      opId = `${opId}${i}`;
    }
    seenOps.add(opId);

    // Path params
    const pathParams: IRParameter[] = [];
    if (isZodSchema(schema.params)) {
      const js = zodToJsonSchema(schema.params);
      const props = (js.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [name, prop] of Object.entries(props)) {
        pathParams.push({
          name,
          location: 'path',
          type: jsonSchemaToTypeRef(prop, `${opId}_${capitalize(name)}`),
          required: true,
          description: prop.description as string | undefined,
        });
      }
    }

    // Query params
    const queryParams: IRParameter[] = [];
    if (isZodSchema(schema.query)) {
      const js = zodToJsonSchema(schema.query);
      const props = (js.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const reqArr = (js.required ?? []) as string[];
      for (const [name, prop] of Object.entries(props)) {
        queryParams.push({
          name,
          location: 'query',
          type: jsonSchemaToTypeRef(prop, `${opId}_${capitalize(name)}`),
          required: reqArr.includes(name),
          description: prop.description as string | undefined,
        });
      }
    }

    // Request body
    let requestBody: IRRequestBody | undefined;
    if (isZodSchema(schema.body)) {
      const js = zodToJsonSchema(schema.body);
      const bodyType = jsonSchemaToIRType(js, `${opId}Request`);
      types.set(bodyType.id, bodyType);
      requestBody = {
        required: true,
        contentType: 'application/json',
        type: { ref: bodyType.id },
      };
    }

    // Response
    const responses: Record<string, IRResponse> = {};
    if (isZodSchema(schema.response)) {
      const js = zodToJsonSchema(schema.response);
      const respType = jsonSchemaToIRType(js, `${opId}Response`);
      types.set(respType.id, respType);
      responses['200'] = {
        statusCode: '200',
        description: 'Successful response',
        contentType: 'application/json',
        type: { ref: respType.id },
      };
    } else if (
      typeof schema.response === 'object' &&
      schema.response !== null &&
      !isZodSchema(schema.response)
    ) {
      // Per-status-code map
      for (const [code, zodSchema] of Object.entries(
        schema.response as Record<string, unknown>,
      )) {
        if (isZodSchema(zodSchema)) {
          const js = zodToJsonSchema(zodSchema);
          const respType = jsonSchemaToIRType(js, `${opId}Response${code}`);
          types.set(respType.id, respType);
          responses[code] = {
            statusCode: code,
            description:
              schema.responseDescriptions?.[code] ?? `Response ${code}`,
            contentType: 'application/json',
            type: { ref: respType.id },
          };
        }
      }
    }
    if (!Object.keys(responses).length) {
      responses['200'] = {
        statusCode: '200',
        description: 'Successful response',
      };
    }

    // Security from schema
    const security = (schema.security ?? []).map(
      (s: Record<string, string[]>) => {
        const [schemeName, scopes] = Object.entries(s)[0] ?? ['', []];
        return { schemeName, scopes };
      },
    );

    endpoints.push({
      operationId: opId,
      summary: schema.summary,
      description: schema.description,
      tags: schema.tags ?? [],
      deprecated: schema.deprecated,
      transport: 'rest',
      method: method.toUpperCase() as IRHttpMethod,
      path,
      pathParams,
      queryParams,
      headerParams: [],
      requestBody,
      responses,
      successResponse: '200',
      security,
    });
  }

  // WebSocket routes
  for (const wsRoute of app.registeredWsRoutes ?? []) {
    const path: string = wsRoute.path ?? '/';
    const rawOpId = `ws${capitalize(path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_'))}`;
    const opId = sanitizeIdentifier(rawOpId);

    endpoints.push({
      operationId: opId,
      summary: wsRoute.schema?.summary,
      tags: wsRoute.schema?.tags ?? ['websocket'],
      transport: 'websocket',
      path,
      pathParams: [],
      queryParams: [],
      headerParams: [],
      responses: {},
      security: [],
    });
  }

  return {
    schema: {
      info: {
        title: options.title ?? 'Axiomify API',
        version: options.version ?? '1.0.0',
        sourceFormat: 'axiomify',
      },
      types,
      endpoints,
      securitySchemes: new Map(),
      servers: [],
      globalSecurity: [],
      events: [],
      reactiveContracts: [],
    },
    diagnostics,
  };
}
