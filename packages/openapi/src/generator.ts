import type { Axiomify, RouteDefinition, RouteSchema } from '@axiomify/core';
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
   * OpenAPI 3.1.0 Components Object. Used to define reusable assets such as
   * global `securitySchemes` referenced by individual routes.
   * @example { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }
   */
  components?: Record<string, unknown>;
  /**
   * Global OpenAPI 3.1.0 Security Requirement Object. Applies to ALL routes by
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

type ZodLike = ZodTypeAny & {
  toJSONSchema?: (opts?: Record<string, unknown>) => Record<string, unknown>;
};

export interface OpenApiGenerationWarning {
  code:
    | 'unrepresentable-zod-schema'
    | 'security-scheme-typo'
    | 'orphaned-security-scheme';
  message: string;
  location: string;
}

function zodSchemaToOpenApi(
  schema: ZodTypeAny,
  onWarning: (message: string) => void,
): Record<string, unknown> {
  const s = schema as ZodLike;

  // Zod v4 native path
  if (typeof s.toJSONSchema === 'function') {
    try {
      // Probe the full schema first, so Zod reports transforms and other
      // runtime-only constructs. `io: input` below deliberately omits a
      // transform's output side and otherwise cannot tell us it was present.
      s.toJSONSchema({ target: 'openApi3_1' });
    } catch (error: any) {
      onWarning(
        `Zod schema contains runtime behaviour that OpenAPI cannot represent (${error?.message || 'unknown conversion error'}). ` +
          'The input schema was exported with the unrepresentable portion widened.',
      );
    }
    try {
      // `io: input` documents what an API caller may send. This is the only
      // meaningful public contract for schemas that transform their output.
      const full = s.toJSONSchema({
        target: 'openApi3_1',
        io: 'input',
        unrepresentable: 'any',
      }) as Record<string, unknown>;
      const { $schema: _dropped, ...rest } = full;
      return rest;
    } catch {
      return {};
    }
  }

  // Zod v3 fallback via zod-to-json-schema
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { zodToJsonSchema } = require('zod-to-json-schema');
    return zodToJsonSchema(schema, { target: 'openApi3' }) as Record<
      string,
      unknown
    >;
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
  private warnings: OpenApiGenerationWarning[] = [];

  constructor(
    private readonly app: Axiomify,
    private readonly options: OpenApiOptions,
  ) {}

  public generate(): Record<string, unknown> {
    this.warnings = [];
    const spec: Record<string, unknown> = {
      openapi: '3.1.0',
      info: this.options.info,
      paths: {} as Record<string, unknown>,
    };

    if (this.options.components) spec.components = this.options.components;
    if (this.options.security) spec.security = this.options.security;

    const components = this.options.components as
      Record<string, unknown> | undefined;
    if (components?.securitySchemas && !components.securitySchemes) {
      this.warn(
        'security-scheme-typo',
        'Found components.securitySchemas. OpenAPI requires components.securitySchemes; Swagger UI cannot render Authorize controls from the misspelled property.',
        '/components/securitySchemas',
      );
    }
    const schemeNames = Object.keys(
      (components?.securitySchemes as Record<string, unknown>) || {},
    );
    this.validateSecurityRequirements(
      this.options.security,
      schemeNames,
      '/security',
    );

    for (const route of this.app.registeredRoutes) {
      // Routes are documented by default. `schema.openapi: false` is an
      // explicit opt-out for internal endpoints; skip before creating the path
      // object so the resulting document has no empty path entries.
      if (route.schema?.openapi === false) continue;

      const openApiPath = this.formatPath(route.path);
      const method = route.method.toLowerCase();
      const paths = spec.paths as Record<string, Record<string, unknown>>;

      if (!paths[openApiPath]) paths[openApiPath] = {};

      // All OAS 3.1.0 Operation Object metadata now lives in `route.schema` —
      // the same block as Zod validation fields. There is no separate
      // `route.openapi` property. One source of truth per route definition.
      const s = route.schema ?? ({} as RouteSchema);
      this.validateSecurityRequirements(
        s.security,
        schemeNames,
        `/paths/${openApiPath}/${method}/security`,
      );

      const operation: Record<string, unknown> = {
        // OAS §4.8.10.2 — summary. Defaults to `${method} ${path}`.
        summary: s.summary ?? `${route.method} ${route.path}`,
        // OAS §4.8.10.5 — operationId for client codegen tools.
        // Auto-synthesised from method+path when omitted:
        //   GET /users/:id → "getUsersById"   POST /users → "postUsers"
        operationId:
          s.operationId ?? this.synthesiseOperationId(route.method, route.path),
        parameters: this.extractParameters(route),
        responses: this.extractResponses(route),
      };

      if (s.description) operation.description = s.description;
      if (s.tags) operation.tags = s.tags;
      // OAS §4.8.10.10: absent key inherits global security; [] opts out.
      if (s.security !== undefined) operation.security = s.security;
      if (s.deprecated) operation.deprecated = true;
      if (s.externalDocs) operation.externalDocs = s.externalDocs;
      // OAS §4.8.10.11 / §4.8.10.8: pass servers + callbacks verbatim.
      if (s.servers) operation.servers = s.servers;
      if (s.callbacks) operation.callbacks = s.callbacks;

      const body = this.extractBody(route);
      if (body) {
        if (s.requestBodyDescription)
          body.description = s.requestBodyDescription;
        operation.requestBody = body;
      }

      paths[openApiPath][method] = operation;
    }

    if (this.warnings.length > 0) spec['x-axiomify-warnings'] = this.warnings;

    return spec;
  }

  /** Warnings from the most recently generated document. */
  public getWarnings(): readonly OpenApiGenerationWarning[] {
    return this.warnings;
  }

  private warn(
    code: OpenApiGenerationWarning['code'],
    message: string,
    location: string,
  ): void {
    const key = `${code}\0${location}\0${message}`;
    if (
      this.warnings.some(
        (warning) =>
          `${warning.code}\0${warning.location}\0${warning.message}` === key,
      )
    )
      return;
    this.warnings.push({ code, message, location });
  }

  private validateSecurityRequirements(
    requirements: unknown,
    schemeNames: string[],
    location: string,
  ): void {
    if (!Array.isArray(requirements)) return;
    requirements.forEach((requirement, index) => {
      if (!requirement || typeof requirement !== 'object') return;
      for (const name of Object.keys(requirement as Record<string, unknown>)) {
        if (!schemeNames.includes(name)) {
          this.warn(
            'orphaned-security-scheme',
            `Security requirement references "${name}", but it is not declared in components.securitySchemes. Swagger UI cannot authorize this operation.`,
            `${location}/${index}`,
          );
        }
      }
    });
  }

  private convertSchema(
    schema: ZodTypeAny,
    location: string,
  ): Record<string, unknown> {
    return zodSchemaToOpenApi(schema, (message) =>
      this.warn('unrepresentable-zod-schema', message, location),
    );
  }

  /** Translates Axiomify path syntax to OpenAPI: `/users/:id` → `/users/{id}` */
  public formatPath(path: string): string {
    return path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
  }

  private extractParameters(route: RouteDefinition): unknown[] {
    const parameters: unknown[] = [];

    if (route.schema?.params) {
      const paramSchema = this.convertSchema(
        route.schema.params as unknown as ZodTypeAny,
        `${route.method} ${route.path} path parameters`,
      );
      const properties =
        (paramSchema.properties as Record<string, unknown>) ?? {};
      for (const [key, prop] of Object.entries(properties)) {
        parameters.push({
          name: key,
          in: 'path',
          required: true,
          schema: prop,
        });
      }
    }

    if (route.schema?.query) {
      const querySchema = this.convertSchema(
        route.schema.query as unknown as ZodTypeAny,
        `${route.method} ${route.path} query parameters`,
      );
      const properties =
        (querySchema.properties as Record<string, unknown>) ?? {};
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

  private extractBody(route: RouteDefinition):
    | {
        required: boolean;
        content: Record<string, unknown>;
        description?: string;
      }
    | undefined {
    if (!route.schema?.body && !route.schema?.files) return undefined;

    const hasFiles = !!route.schema.files;
    const contentType = hasFiles ? 'multipart/form-data' : 'application/json';

    let finalSchema: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };

    if (route.schema.body) {
      const bodySchema = this.convertSchema(
        route.schema.body as unknown as ZodTypeAny,
        `${route.method} ${route.path} request body`,
      );

      if (bodySchema.type === 'object') {
        finalSchema.properties = {
          ...(bodySchema.properties as Record<string, unknown>),
        };
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
      const files = route.schema.files as Record<
        string,
        { maxSize?: number; description?: string }
      >;
      const props = (finalSchema.properties as Record<string, unknown>) ?? {};
      for (const [fieldName, config] of Object.entries(files)) {
        props[fieldName] = {
          type: 'string',
          format: 'binary',
          ...(config.description ? { description: config.description } : {}),
          ...(config.maxSize
            ? { description: `Max size: ${config.maxSize} bytes` }
            : {}),
        };
      }
      finalSchema.properties = props;
    }

    return {
      required: true,
      content: { [contentType]: { schema: finalSchema } },
    };
  }

  private extractResponses(route: RouteDefinition): Record<string, unknown> {
    // Pull the per-status description map. Authors override generator
    // defaults via schema.responseDescriptions: { '200': '...', '404': '...' }.
    const descriptions =
      (route.schema as RouteSchema)?.responseDescriptions ?? {};

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
          'application/json': {
            schema: this.convertSchema(
              responseSchema,
              `${route.method} ${route.path} response 200`,
            ),
          },
        },
      };
    } else if (typeof responseSchema === 'object' && responseSchema !== null) {
      for (const [code, schema] of Object.entries(
        responseSchema as unknown as Record<string, ZodTypeAny>,
      )) {
        responses[code] = {
          description: descriptions[code] ?? `Response ${code}`,
          content: {
            'application/json': {
              schema: this.convertSchema(
                schema,
                `${route.method} ${route.path} response ${code}`,
              ),
            },
          },
        };
      }
    }

    return Object.keys(responses).length > 0 ? responses : defaultResponse;
  }
}
