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
  // Default the prefix so an omitted `routePrefix` doesn't register routes
  // at the literal path "undefined/openapi.json". Also normalize trailing
  // slashes so "/docs" and "/docs/" behave identically.
  const rawPrefix = options.routePrefix ?? '/docs';
  const normalizedPrefix = rawPrefix.startsWith('/')
    ? rawPrefix
    : `/${rawPrefix}`;
  const prefix = normalizedPrefix === '/'
    ? '/'
    : normalizedPrefix.endsWith('/')
    ? normalizedPrefix.slice(0, -1)
    : normalizedPrefix;
  const docsPaths = prefix === '/' ? ['/'] : [prefix, `${prefix}/`];
  const docsPathSet = new Set(docsPaths);
  const specPath = prefix === '/' ? '/openapi.json' : `${prefix}/openapi.json`;

  const generator = new OpenApiGenerator(app, options);
  let cachedSpec: any = null;
  let cachedSpecJson: string | null = null;
  let emittedPublicDocsWarning = false;

  if (options.autoInferResponses) {
    // Capture inferred response schemas via an onPostHandler hook instead of
    // mutating each `route.handler`. Mutating registered route handlers is a
    // hidden side effect that breaks plugins that compare or cache handler refs.
    app.addHook('onPostHandler', (req, res, match) => {
      if (!match?.route) return;

      // Skip self-requests to docs endpoints.
      if (
        req.path === specPath ||
        docsPathSet.has(req.path)
      ) {
        return;
      }

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
        cachedSpecJson = null;
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
    path: specPath,
    handler: async (req, res) => {
      if (!(await guard(req))) return res.status(403).send(null, 'Forbidden');
      if (!cachedSpec) cachedSpec = generator.generate();
      if (!cachedSpecJson) cachedSpecJson = JSON.stringify(cachedSpec);
      res.status(200).sendRaw(cachedSpecJson, 'application/json');
    },
  });

  const docsHandler = async (req: AxiomifyRequest, res: any) => {
    if (!(await guard(req))) return res.status(403).send(null, 'Forbidden');

    // Cache-bust only in non-production. In production the spec is stable,
    // so allow the browser to cache the URL.
    const isDev = process.env.NODE_ENV !== 'production';
    const specUrl = isDev
      ? `${specPath}?t=${Date.now()}`
      : specPath;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.info.title)} - API Docs</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self'; font-src https://cdnjs.cloudflare.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css" integrity="sha384-bIuUyBV7i6P7z/kPAs1oeBIf8PMIqVkPVDzzaOL+QH7kWmvCT9HDTWwGVs0L4/9Q" crossorigin="anonymous" referrerpolicy="no-referrer" />
</head>
<body style="margin: 0; padding: 0;">
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.min.js" integrity="sha384-XHDYRdiHvBq7oL4CtkiJKfdVVA5PydxYtssHVtRrvPlha1m+zz8kboiyx/MAsyl3" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
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
  };
  for (const docsPath of docsPaths) {
    app.route({
      method: 'GET',
      path: docsPath,
      handler: docsHandler,
    });
  }
}
