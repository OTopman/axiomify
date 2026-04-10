import type { Axiomify, RouteDefinition } from '@axiomify/core';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface OpenApiOptions {
  info: {
    title: string;
    version: string;
    description?: string;
  };
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
        responses: {
          '200': {
            description: 'Successful response',
            content: this.extractResponse(route),
          },
        },
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
      // FIX: Add "as any" inside the function call
      const paramSchema = zodToJsonSchema(route.schema.params as any, {
        target: 'openApi3',
      }) as any;
      for (const [key, prop] of Object.entries(paramSchema.properties || {})) {
        // ... rest of the loop remains the same
        parameters.push({
          name: key,
          in: 'path',
          required: paramSchema.required?.includes(key) || true,
          schema: prop,
        });
      }
    }

    if (route.schema?.query) {
      // FIX: Add "as any" inside the function call
      const querySchema = zodToJsonSchema(route.schema.query as any, {
        target: 'openApi3',
      }) as any;
      for (const [key, prop] of Object.entries(querySchema.properties || {})) {
        // ... rest of the loop remains the same
        parameters.push({
          name: key,
          in: 'query',
          required: querySchema.required?.includes(key) || false,
          schema: prop,
        });
      }
    }

    return parameters;
  }

  private extractBody(route: RouteDefinition): any {
    const buildRequestBody = (schema: any) => {
      // 🚀 THE FIX: Check if schema itself exists before checking its properties!
      if (!schema || (!schema.body && !schema.files)) {
        return undefined;
      }

      const hasFiles = !!schema.files;
      const contentType = hasFiles ? 'multipart/form-data' : 'application/json';
      const properties: Record<string, any> = {};
      let requiredFields: string[] = [];

      // 🚀 The Fix: Safely cast the generated schema to bypass the strict Union Type
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
      return { 'application/json': { schema: { type: 'object' } } };
    }
    return {
      'application/json': {
        // FIX: Add "as any" inside the function call
        schema: zodToJsonSchema(route.schema.response as any, {
          target: 'openApi3',
        }),
      },
    };
  }
}
