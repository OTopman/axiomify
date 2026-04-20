import type { Axiomify, RouteDefinition } from '@axiomify/core';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface OpenApiOptions {
  info: {
    title: string;
    version: string;
    description?: string;
  };
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

    for (const route of this.app.registeredRoutes) {
      const openApiPath = this.formatPath(route.path);
      const method = route.method.toLowerCase();

      if (!spec.paths[openApiPath]) {
        spec.paths[openApiPath] = {};
      }

      spec.paths[openApiPath][method] = {
        summary: `Handler for ${route.method} ${route.path}`,
        parameters: this.extractParameters(route),
        requestBody: this.extractBody(route),
        responses: this.extractResponse(route), // Pass route directly
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

  private extractParameters(route: RouteDefinition): any[] {
    const parameters: any[] = [];

    if (route.schema?.params) {
      const paramSchema = zodToJsonSchema(route.schema.params as any, {
        target: 'openApi3',
      }) as any;
      for (const [key, prop] of Object.entries(paramSchema.properties || {})) {
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
    const buildRequestBody = (schema: any) => {
      //  Check if schema itself exists before checking its properties!
      if (!schema || (!schema.body && !schema.files)) {
        return undefined;
      }

      const hasFiles = !!schema.files;
      const contentType = hasFiles ? 'multipart/form-data' : 'application/json';
      const properties: Record<string, any> = {};
      let requiredFields: string[] = [];

      //  Safely cast the generated schema to bypass the strict Union Type
      if (schema.body) {
        const bodySchema = zodToJsonSchema(schema.body) as any;

        // Safely extract properties if it's an object
        if (bodySchema.properties) {
          Object.assign(properties, bodySchema.properties);
        }

        // Safely extract the required array
        if (bodySchema.required) {
          requiredFields = bodySchema.required;
        }
      }

      // Attach the File fields for the Swagger UI
      if (hasFiles) {
        for (const fieldName of Object.keys(schema.files)) {
          properties[fieldName] = {
            type: 'string',
            format: 'binary',
            description: `Max size: ${schema.files[fieldName].maxSize} bytes`,
          };
        }
      }

      return {
        content: {
          [contentType]: {
            schema: {
              type: 'object',
              properties: properties,
              // Only attach 'required' if there are actually required fields
              required: requiredFields.length > 0 ? requiredFields : undefined,
            },
          },
        },
      };
    };
    return buildRequestBody(route.schema);
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
