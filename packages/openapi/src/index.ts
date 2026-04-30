import type { Axiomify, AxiomifyRequest } from '@axiomify/core';
import { OpenApiGenerator, OpenApiOptions } from './generator';

export interface SwaggerPluginOptions extends OpenApiOptions {
  routePrefix?: string;
  /**
   * Optional gate for the docs UI and the raw spec endpoint.
   * Return false to deny. Recommended for production / non-public APIs.
   */
  protect?: (req: AxiomifyRequest) => boolean | Promise<boolean>;
  /**
   * Explicitly allow public OpenAPI docs in production. Defaults to false.
   */
  allowPublicInProduction?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function defineSecuritySchemes<const T extends Record<string, unknown>>(
  schemes: T,
) {
  return {
    schemes,
    require: (
      name: keyof T,
      scopes: string[] = [],
    ): Array<Record<string, string[]>> => [{ [name as string]: scopes }],
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

export const Security = defineSecuritySchemes({
  bearerAuth: { type: 'http', scheme: 'bearer' },
  apiKey: { type: 'apiKey', in: 'header', name: 'X-API-KEY' },
  basicAuth: { type: 'http', scheme: 'basic' },
} as const);

function inferSchemaFromPayload<T = unknown>(data: T, depth = 0): T {
  // Hard depth cap prevents stack overflow on pathological inputs.
  if (depth > 32) return { type: 'object' } as T;
  if (data === null) return { type: 'null' } as T;
  if (Array.isArray(data)) {
    return {
      type: 'array',
      items:
        data.length > 0
          ? inferSchemaFromPayload(data[0], depth + 1)
          : { type: 'object' },
    } as T;
  }
  if (typeof data === 'object') {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      properties[key] = inferSchemaFromPayload(value, depth + 1);
    }
    return { type: 'object', properties } as T;
  }
  return { type: typeof data } as T;
}

export function useOpenAPI(app: Axiomify, options: SwaggerPluginOptions): void {
  const rawPrefix = options.routePrefix ?? '/docs';
  const normalizedPrefix = rawPrefix.startsWith('/')
    ? rawPrefix
    : `/${rawPrefix}`;
  const prefix = normalizedPrefix.endsWith('/')
    ? normalizedPrefix.slice(0, -1)
    : normalizedPrefix;

  const generator = new OpenApiGenerator(app, options);
  let cachedSpec: any = null;
  let emittedPublicDocsWarning = false;

  if (options.autoInferResponses) {
    // Capture inferred response schemas via an onPostHandler hook instead of
    // mutating each `route.handler`. Mutating registered route handlers is a
    // hidden side effect that breaks plugins that compare or cache handler refs.
    app.addHook('onPostHandler', (req, res, match) => {
      if (!match?.route) return;

      // Skip self-requests to docs endpoints.
      if (req.path === `${prefix}/openapi.json` || req.path === prefix) return;

      const payload = (res as any).payload;
      if (payload === undefined) return;

      if (!cachedSpec) cachedSpec = generator.generate();

      const path = (generator as any).formatPath(match.route.path);
      const method = match.route.method.toLowerCase();
      const statusCode = String(res.statusCode);

      const existingResponse =
        cachedSpec.paths[path]?.[method]?.responses?.[statusCode];
      const isDefault =
        existingResponse?.description === 'Successful response' &&
        existingResponse?.content?.['application/json']?.schema?.type ===
          'object';

      if (existingResponse && !isDefault) return;

      let parsedData: unknown = payload;
      if (typeof payload === 'string') {
        try {
          parsedData = JSON.parse(payload);
        } catch {
          /* leave as string */
        }
      }

      if (cachedSpec.paths[path]?.[method]) {
        cachedSpec.paths[path][method].responses[statusCode] = {
          description: 'Auto-inferred response',
          content: {
            'application/json': { schema: inferSchemaFromPayload(parsedData) },
          },
        };
      }
    });
  }

  const guard = async (req: AxiomifyRequest): Promise<boolean> => {
    if (!options.protect) {
      if (process.env.NODE_ENV === 'production') {
        if (!emittedPublicDocsWarning) {
          emittedPublicDocsWarning = true;
          console.warn(
            '[axiomify/openapi] OpenAPI endpoints are not protected. ' +
              'Production access is denied by default. Provide a `protect` ' +
              'function or set `allowPublicInProduction: true` explicitly.',
          );
        }
        return options.allowPublicInProduction === true;
      }
      return true;
    }
    return Boolean(await options.protect(req));
  };

  app.route({
    method: 'GET',
    path: `${prefix}/openapi.json`,
    handler: async (req, res) => {
      if (!(await guard(req))) return res.status(403).send(null, 'Forbidden');
      if (!cachedSpec) cachedSpec = generator.generate();
      res.status(200).sendRaw(JSON.stringify(cachedSpec), 'application/json');
    },
  });

  app.route({
    method: 'GET',
    path: `${prefix}`,
    handler: async (req, res) => {
      if (!(await guard(req))) return res.status(403).send(null, 'Forbidden');

      // Cache-bust only in non-production. In production the spec is stable,
      // so allow the browser to cache the URL.
      const isDev = process.env.NODE_ENV !== 'production';
      const specUrl = isDev
        ? `${prefix}/openapi.json?t=${Date.now()}`
        : `${prefix}/openapi.json`;

      const html = `<!DOCTYPE html>
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
</html>`;
      res.status(200).sendRaw(html, 'text/html');
    },
  });
}
