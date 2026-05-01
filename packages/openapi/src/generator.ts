import type { Axiomify, RouteDefinition } from '@axiomify/core';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface OpenApiOptions {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  autoInferResponses?: boolean;

  /**
   * OpenAPI 3.0 Components Object.
   * Used to define reusable documentation assets, such as global `securitySchemes`
   * (e.g., Bearer tokens, API keys) that can be referenced by individual routes.
   * @example { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }
   */
  components?: Record<string, unknown>;

  /**
   * Global OpenAPI 3.0 Security Requirement Object.
   * Applies the specified security configuration to ALL routes in the application by default.
   * Individual routes can override this by defining their own `schema.security` array.
   * @example [{ bearerAuth: [] }]
   */
  security?: Array<Record<string, string[]>>;
}

/**
 * Duck-types a value as a Zod schema without reaching into `_def` (internal,
 * unstable across Zod majors). Anything exposing `safeParse` is treated as a
 * single validator; otherwise we assume a `Record<statusCode, ZodTypeAny>`.
 */
function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).safeParse === 'function'
  );
}

export class OpenApiGenerator {
  constructor(private app: Axiomify, private options: OpenApiOptions) {}

  public generate(): Record<string, any> {
    const spec: any = {
      openapi: '3.0.3',
      info: this.options.info,
      paths: {},
    };

    if (this.options.components) {
      spec.components = this.options.components;
    }

    if (this.options.security) {
      spec.security = this.options.security;
    }

    for (const route of this.app.registeredRoutes) {
      const openApiPath = this.formatPath(route.path);
      const method = route.method.toLowerCase();

      if (!spec.paths[openApiPath]) {
        spec.paths[openApiPath] = {};
      }

      spec.paths[openApiPath][method] = {
        summary: `Handler for ${route.method} ${route.path}`,
        description: route.schema?.description,
        tags: route.schema?.tags,
        parameters: this.extractParameters(route),
        requestBody: this.extractBody(route),
        responses: this.extractResponse(route), // Pass route directly
        ...(route.schema?.security && { security: route.schema.security }),
      };
    }

    return spec;
  }

  /**
   * Translates /users/:id to /users/{id}
   */
  private formatPath(path: string): string {
    return path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
  }

  private extractParameters(route: RouteDefinition): unknown[] {
    const parameters: unknown[] = [];

    if (route.schema?.params) {
      const paramSchema = zodToJsonSchema(route.schema.params as any, {
        target: 'openApi3',
      });
      for (const [key, prop] of Object.entries(
        (paramSchema as any).properties || {},
      )) {
        parameters.push({
          name: key,
          in: 'path',
          // OpenAPI 3 requires `required: true` for every path parameter.
          // The previous expression was `paramSchema.required?.includes(key) || true`
          // — the trailing `|| true` made the whole left side dead code.
          required: true,
          schema: prop,
        });
      }
    }

    if (route.schema?.query) {
      const querySchema = zodToJsonSchema(route.schema.query as any, {
        target: 'openApi3',
      }) as any;
      for (const [key, prop] of Object.entries(querySchema.properties || {})) {
        parameters.push({
          name: key,
          in: 'query',
          required: querySchema.required?.includes(key) ?? false,
          schema: prop,
        });
      }
    }

    return parameters;
  }

  private extractBody(route: RouteDefinition): any {
    if (!route.schema || (!route.schema.body && !route.schema.files)) {
      return undefined;
    }

    const hasFiles = !!route.schema.files;
    const contentType = hasFiles ? 'multipart/form-data' : 'application/json';

    let finalSchema: any = { type: 'object', properties: {} };

    if (route.schema.body) {
      const bodySchema = zodToJsonSchema(route.schema.body as any, {
        target: 'openApi3',
      }) as any;

      if (bodySchema.type === 'object') {
        // Standard JSON object payload
        finalSchema.properties = { ...bodySchema.properties };
        if (bodySchema.required) finalSchema.required = bodySchema.required;
      } else {
        // Arrays or Primitives (e.g., z.array(z.string()))
        if (!hasFiles) {
          finalSchema = bodySchema; // Output the array schema directly
        } else {
          // Mixed multipart: Wrap the array inside a generic payload property
          finalSchema.properties['payload'] = bodySchema;
        }
      }
    }

    if (hasFiles) {
      // Tell TypeScript to treat the generic files object as a standard record
      for (const [fieldName, config] of Object.entries(
        route.schema.files as Record<string, any>,
      )) {
        finalSchema.properties[fieldName] = {
          type: 'string',
          format: 'binary',
          description: `Max size: ${config.maxSize} bytes`,
        };
      }
    }

    return {
      content: {
        [contentType]: { schema: finalSchema },
      },
    };
  }

  private extractResponse(route: RouteDefinition): any {
    if (!route.schema?.response) {
      return {
        '200': {
          description: 'Successful response',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      };
    }

    const responseSchema = route.schema.response;

    const responses: any = {};

    if (isZodSchema(responseSchema)) {
      // Single schema defaults to 200
      responses['200'] = {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: zodToJsonSchema(responseSchema as any, {
              target: 'openApi3',
            }),
          },
        },
      };
    } else if (typeof responseSchema === 'object' && responseSchema !== null) {
      // Handle custom Record mapping (e.g., { 200: z.object, 400: z.object })
      for (const [code, schema] of Object.entries(responseSchema)) {
        responses[code] = {
          description: `Response ${code}`,
          content: {
            'application/json': {
              schema: zodToJsonSchema(schema as any, { target: 'openApi3' }),
            },
          },
        };
      }
    }

    return responses;
  }
}
