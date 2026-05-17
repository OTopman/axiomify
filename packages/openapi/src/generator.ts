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

      // OAS 3.0.3 Operation Object metadata lives on `route.openapi`.
      // The 4.x `route.meta` alias was deprecated through 5.x and is
      // removed in 6.0 — `meta:` on a route definition is now a plain
      // unknown property and the generator ignores it.
      const op = route.openapi ?? undefined;

      const operation: Record<string, unknown> = {
        // OAS §4.7.10.2 — summary. Default to `${method} ${path}` so the
        // docs UI always has a human-readable title even without user input.
        summary: op?.summary ?? `${route.method} ${route.path}`,
        // OAS §4.7.10.5 — operationId. Client codegen tools
        // (openapi-typescript, openapi-generator) use this to name the
        // generated function. When the user doesn't supply one we
        // synthesise a stable name from method+path:
        //   GET /users/:id → "getUsersById"
        //   POST /users    → "postUsers"
        // Determinism matters here — codegen output should not drift
        // between releases unless method+path actually change.
        operationId:
          op?.operationId ?? this.synthesiseOperationId(route.method, route.path),
        parameters: this.extractParameters(route),
        responses: this.extractResponses(route),
      };

      // Legacy schema-level fields (tags/description/security INSIDE the
      // `schema:` block) were a 3.x pattern; the generator has supported
      // both `meta` and that legacy path. Continue accepting them — the
      // cost is one read, and removing it would silently break old code
      // that's still passing tests.
      type LegacySchema = {
        description?: string;
        tags?: string[];
        security?: Array<Record<string, string[]>>;
      };
      const legacySchema = (route.schema ?? {}) as LegacySchema;

      const description = op?.description ?? legacySchema.description;
      const tags        = op?.tags        ?? legacySchema.tags;
      const security    = op?.security    ?? legacySchema.security;

      if (description) operation.description = description;
      if (tags)        operation.tags        = tags;
      // OAS §4.7.10.10 — `security`: an absent key inherits the global
      // security requirement; an empty array (`[]`) explicitly opts the
      // operation OUT of all global security. Both are spec-valid and
      // semantically distinct — only skip emission when undefined.
      if (security !== undefined) operation.security = security;
      if (op?.deprecated) operation.deprecated = true;
      if (op?.externalDocs) operation.externalDocs = op.externalDocs;
      // OAS §4.7.10.11 / §4.7.10.8 — pass servers and callbacks through
      // verbatim. The framework doesn't derive these; the user supplies
      // them exactly as the spec defines.
      if (op?.servers) operation.servers = op.servers;
      if (op?.callbacks) operation.callbacks = op.callbacks;

      const body = this.extractBody(route);
      if (body) {
        if (op?.requestBodyDescription) {
          body.description = op.requestBodyDescription;
        }
        operation.requestBody = body;
      }

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

  /**
   * Synthesise a stable, codegen-friendly operationId from method+path
   * when the route definition doesn't supply one. Example outputs:
   *   GET  /users/:id            → getUsersById
   *   POST /users                → postUsers
   *   GET  /users/:id/posts/:pid → getUsersByIdPostsByPid
   *
   * Determinism matters here — client codegen produces the same function
   * names on every run as long as method+path are stable.
   */
  private synthesiseOperationId(method: string, path: string): string {
    const verb = method.toLowerCase();
    const parts: string[] = [];
    for (const seg of path.split('/')) {
      if (!seg) continue;
      if (seg.startsWith(':')) {
        const name = seg.slice(1);
        parts.push('By', name.charAt(0).toUpperCase() + name.slice(1));
      } else if (seg === '*') {
        parts.push('All');
      } else {
        parts.push(seg.charAt(0).toUpperCase() + seg.slice(1));
      }
    }
    return verb + parts.join('');
  }

  private extractBody(route: RouteDefinition): { required: boolean; content: Record<string, unknown>; description?: string } | undefined {
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
    // Pull the per-status description map once. Authors can override the
    // generator defaults ('Successful response', 'Response 404') by passing
    // openapi.responseDescriptions: { '200': '...', '404': '...' }.
    const op = route.openapi;
    const descriptions = op?.responseDescriptions ?? {};

    const defaultResponse = {
      '200': {
        description: descriptions['200'] ?? 'Successful response',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    };

    if (!route.schema?.response) return defaultResponse;

    const responseSchema = route.schema.response;
    const responses: Record<string, unknown> = {};

    if (isZodSchema(responseSchema)) {
      responses['200'] = {
        description: descriptions['200'] ?? 'Successful response',
        content: {
          'application/json': { schema: zodSchemaToOpenApi(responseSchema) },
        },
      };
    } else if (typeof responseSchema === 'object' && responseSchema !== null) {
      for (const [code, schema] of Object.entries(
        responseSchema as unknown as Record<string, ZodTypeAny>,
      )) {
        responses[code] = {
          description: descriptions[code] ?? `Response ${code}`,
          content: {
            'application/json': { schema: zodSchemaToOpenApi(schema) },
          },
        };
      }
    }

    return Object.keys(responses).length > 0 ? responses : defaultResponse;
  }
}
