import type { Axiomify, RouteDefinition } from '@axiomify/core';
import type { ZodTypeAny } from 'zod';

export interface OpenApiOptions {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  /** Automatically infer 200 response schema from `schema.response`. Default: true */
  autoInferResponses?: boolean;
  /**
   * OpenAPI 3.0 Components Object. Used to define reusable assets such as
   * global `securitySchemes` referenced by individual routes.
   * @example { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }
   */
  components?: Record<string, unknown>;
  /**
   * Global OpenAPI 3.0 Security Requirement Object. Applies to ALL routes by
   * default. Individual routes can override via `schema.security`.
   * @example [{ bearerAuth: [] }]
   */
  security?: Array<Record<string, string[]>>;
}

// ─── Zod → JSON Schema conversion ────────────────────────────────────────────
// Zod v4 ships `z.toJSONSchema()` built-in. zod-to-json-schema (v3.x) does
// NOT support Zod v4 — it returns `{}` for every schema.
// We use the built-in method when available; fall back to zod-to-json-schema
// only for Zod v3 installations.

type ZodLike = ZodTypeAny & { toJSONSchema?: (opts?: Record<string, unknown>) => Record<string, unknown> };

function zodSchemaToOpenApi(schema: ZodTypeAny): Record<string, unknown> {
  const s = schema as ZodLike;

  // Zod v4 native path
  if (typeof s.toJSONSchema === 'function') {
    const full = s.toJSONSchema({ target: 'openApi3_1' }) as Record<string, unknown>;
    // Strip the $schema meta key — OpenAPI objects don't include it inline.
    const { $schema: _dropped, ...rest } = full as Record<string, unknown>;
    return rest;
  }

  // Zod v3 fallback via zod-to-json-schema
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zodToJsonSchema } = require('zod-to-json-schema');
    return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

function isZodSchema(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

// ─── Generator ────────────────────────────────────────────────────────────────

export class OpenApiGenerator {
  constructor(
    private readonly app: Axiomify,
    private readonly options: OpenApiOptions,
  ) {}

  public generate(): Record<string, unknown> {
    const spec: Record<string, unknown> = {
      openapi: '3.0.3',
      info: this.options.info,
      paths: {} as Record<string, unknown>,
    };

    if (this.options.components) spec.components = this.options.components;
    if (this.options.security) spec.security = this.options.security;

    for (const route of this.app.registeredRoutes) {
      const openApiPath = this.formatPath(route.path);
      const method = route.method.toLowerCase();
      const paths = spec.paths as Record<string, Record<string, unknown>>;

      if (!paths[openApiPath]) paths[openApiPath] = {};

      const operation: Record<string, unknown> = {
        // meta.summary takes priority over the default method+path string.
        summary: route.meta?.summary ?? `${route.method} ${route.path}`,
        parameters: this.extractParameters(route),
        responses: this.extractResponses(route),
      };

      // Read from meta (new canonical location) with fallback to schema fields
      // (deprecated location) for backward compatibility.
      const description = route.meta?.description ?? (route.schema as any)?.description;
      const tags = route.meta?.tags ?? (route.schema as any)?.tags;
      const security = route.meta?.security ?? (route.schema as any)?.security;

      if (description) operation.description = description;
      if (tags) operation.tags = tags;
      if (security) operation.security = security;

      const body = this.extractBody(route);
      if (body) operation.requestBody = body;

      paths[openApiPath][method] = operation;
    }

    return spec;
  }

  /** Translates Axiomify path syntax to OpenAPI: `/users/:id` → `/users/{id}` */
  public formatPath(path: string): string {
    return path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
  }

  private extractParameters(route: RouteDefinition): unknown[] {
    const parameters: unknown[] = [];

    if (route.schema?.params) {
      const paramSchema = zodSchemaToOpenApi(route.schema.params as unknown as ZodTypeAny);
      const properties = (paramSchema.properties as Record<string, unknown>) ?? {};
      for (const [key, prop] of Object.entries(properties)) {
        parameters.push({ name: key, in: 'path', required: true, schema: prop });
      }
    }

    if (route.schema?.query) {
      const querySchema = zodSchemaToOpenApi(route.schema.query as unknown as ZodTypeAny);
      const properties = (querySchema.properties as Record<string, unknown>) ?? {};
      const required = (querySchema.required as string[]) ?? [];
      for (const [key, prop] of Object.entries(properties)) {
        parameters.push({
          name: key,
          in: 'query',
          required: required.includes(key),
          schema: prop,
        });
      }
    }

    return parameters;
  }

  private extractBody(route: RouteDefinition): unknown {
    if (!route.schema?.body && !route.schema?.files) return undefined;

    const hasFiles = !!route.schema.files;
    const contentType = hasFiles ? 'multipart/form-data' : 'application/json';

    let finalSchema: Record<string, unknown> = { type: 'object', properties: {} };

    if (route.schema.body) {
      const bodySchema = zodSchemaToOpenApi(route.schema.body as unknown as ZodTypeAny);

      if (bodySchema.type === 'object') {
        finalSchema.properties = { ...(bodySchema.properties as Record<string, unknown>) };
        if (bodySchema.required) finalSchema.required = bodySchema.required;
        if (bodySchema.additionalProperties !== undefined) {
          finalSchema.additionalProperties = bodySchema.additionalProperties;
        }
      } else {
        // Arrays or primitives — output directly unless mixing with files
        finalSchema = hasFiles
          ? { type: 'object', properties: { payload: bodySchema } }
          : bodySchema;
      }
    }

    if (hasFiles) {
      const files = route.schema.files as Record<string, { maxSize?: number; description?: string }>;
      const props = (finalSchema.properties as Record<string, unknown>) ?? {};
      for (const [fieldName, config] of Object.entries(files)) {
        props[fieldName] = {
          type: 'string',
          format: 'binary',
          ...(config.description ? { description: config.description } : {}),
          ...(config.maxSize ? { description: `Max size: ${config.maxSize} bytes` } : {}),
        };
      }
      finalSchema.properties = props;
    }

    return { required: true, content: { [contentType]: { schema: finalSchema } } };
  }

  private extractResponses(route: RouteDefinition): Record<string, unknown> {
    const defaultResponse = {
      '200': {
        description: 'Successful response',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    };

    if (!route.schema?.response) return defaultResponse;

    const responseSchema = route.schema.response;
    const responses: Record<string, unknown> = {};

    if (isZodSchema(responseSchema)) {
      responses['200'] = {
        description: 'Successful response',
        content: {
          'application/json': { schema: zodSchemaToOpenApi(responseSchema) },
        },
      };
    } else if (typeof responseSchema === 'object' && responseSchema !== null) {
      for (const [code, schema] of Object.entries(
        responseSchema as unknown as Record<string, ZodTypeAny>,
      )) {
        responses[code] = {
          description: `Response ${code}`,
          content: {
            'application/json': { schema: zodSchemaToOpenApi(schema) },
          },
        };
      }
    }

    return Object.keys(responses).length > 0 ? responses : defaultResponse;
  }
}
