import type { Axiomify } from '@axiomify/core';
import { OpenApiGenerator, OpenApiOptions } from './generator';

export interface SwaggerPluginOptions extends OpenApiOptions {
  routePrefix?: string; // e.g., '/docs'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a value for interpolation into a single-quoted JS string literal
 * inside the inline Swagger bootstrap script. Defense in depth: the prefix is
 * developer-controlled, but a stray apostrophe would otherwise break the UI.
 */
function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * A strongly-typed factory for defining OpenAPI security schemes.
 * Provides IntelliSense for routes without requiring global type declarations.
 */
export function defineSecuritySchemes<const T extends Record<string, unknown>>(
  schemes: T,
) {
  return {
    /** The raw OpenAPI components object to pass into `useOpenAPI` */
    schemes,

    /** * Typed helper to inject security requirements into a RouteSchema.
     * Enforces that the developer can only pass valid, registered scheme names.
     */
    require: (
      name: keyof T,
      scopes: string[] = [],
    ): Array<Record<string, string[]>> => {
      return [{ [name as string]: scopes }];
    },

    /** Helper for multiple required schemes (e.g., both API Key AND OAuth) */
    requireMultiple: (
      requirements: Array<keyof T>,
    ): Array<Record<string, string[]>> => {
      const combined: Record<string, string[]> = {};
      requirements.forEach((req) => {
        combined[req as string] = [];
      });
      return [combined];
    },
  };
}

// 2. Export the "Batteries Included" default configuration
export const Security = defineSecuritySchemes({
  bearerAuth: { type: 'http', scheme: 'bearer' },
  apiKey: { type: 'apiKey', in: 'header', name: 'X-API-KEY' },
  basicAuth: { type: 'http', scheme: 'basic' },
} as const);

export function useOpenAPI(app: Axiomify, options: SwaggerPluginOptions): void {
  // Default the prefix so an omitted `routePrefix` doesn't register routes
  // at the literal path "undefined/openapi.json". Also normalize trailing
  // slashes so "/docs" and "/docs/" behave identically.
  const rawPrefix = options.routePrefix ?? '/docs';
  const normalizedPrefix = rawPrefix.startsWith('/')
    ? rawPrefix
    : `/${rawPrefix}`;
  const prefix = normalizedPrefix.endsWith('/')
    ? normalizedPrefix.slice(0, -1)
    : normalizedPrefix;

  const generator = new OpenApiGenerator(app, options);

  let cachedSpec: any = null;

  if (options.autoInferResponses) {
    for (const route of app.registeredRoutes) {
      const originalHandler = route.handler;

      route.handler = async (req, res) => {
        const originalSend = res.send.bind(res);
        const originalSendRaw = res.sendRaw.bind(res);

        const capturePayload = (data: unknown) => {
          if (!cachedSpec) cachedSpec = generator.generate();

          const path = generator['formatPath'](route.path);
          const method = route.method.toLowerCase();
          const statusCode = res.statusCode.toString();

          const existingResponse =
            cachedSpec.paths[path]?.[method]?.responses?.[statusCode];
          const isDefault =
            existingResponse?.description === 'Successful response' &&
            existingResponse?.content?.['application/json']?.schema?.type ===
              'object';

          if (!existingResponse || isDefault) {
            // Ensure we profile an object, even if sendRaw passed a JSON string
            let parsedData = data;
            if (typeof data === 'string') {
              try {
                parsedData = JSON.parse(data);
              } catch {
                /* empty */
              }
            }

            cachedSpec.paths[path][method].responses[statusCode] = {
              description: `Auto-inferred response`,
              content: {
                'application/json': {
                  schema: inferSchemaFromPayload(parsedData),
                },
              },
            };
          }
        };

        // Intercept standard sends
        res.send = <T>(data: T, message?: string) => {
          capturePayload(data);
          originalSend(data, message);
        };

        // Intercept raw sends (only if it's JSON)
        res.sendRaw = (payload: unknown, contentType?: string) => {
          if (!contentType || contentType.includes('application/json')) {
            capturePayload(payload);
          }
          originalSendRaw(payload, contentType);
        };

        return originalHandler(req, res);
      };
    }
  }

  // 1. Serve the raw OpenAPI JSON
  app.route({
    method: 'GET',
    path: `${prefix}/openapi.json`,
    handler: async (_req, res) => {
      if (!cachedSpec) {
        cachedSpec = generator.generate();
      }
      res.status(200).sendRaw(JSON.stringify(cachedSpec), 'application/json');
    },
  });

  // 2. Serve the Swagger UI HTML
  app.route({
    method: 'GET',
    path: `${prefix}`,
    handler: async (_req, res) => {
      // const specUrl = `${prefix}/openapi.json`;
      const specUrl = `${prefix}/openapi.json?t=${Date.now()}`;

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${escapeHtml(options.info.title)} - API Docs</title>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css" />
        </head>
        <body style="margin: 0; padding: 0;">
          <div id="swagger-ui"></div>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.min.js"></script>
          <script>
            window.onload = () => {
              window.ui = SwaggerUIBundle({
                url: '${escapeJsString(specUrl)}',
                dom_id: '#swagger-ui',
              });
            };
          </script>
        </body>
        </html>
      `;

      res.status(200).sendRaw(html, 'text/html');
    },
  });
}

/**
 * Recursively maps a live JavaScript object to an OpenAPI 3.0 Schema
 */
function inferSchemaFromPayload<T = unknown>(data: T): T {
  if (data === null) return { type: 'null' } as T;
  if (Array.isArray(data)) {
    return {
      type: 'array',
      items:
        data.length > 0 ? inferSchemaFromPayload(data[0]) : { type: 'object' },
    } as T;
  }
  if (typeof data === 'object') {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      properties[key] = inferSchemaFromPayload(value);
    }
    return { type: 'object', properties } as T;
  }
  return { type: typeof data } as T; // string, number, boolean
}
