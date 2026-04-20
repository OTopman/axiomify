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
 * inside the inline Swagger bootstrap script. Defence in depth: the prefix is
 * developer-controlled, but a stray apostrophe would otherwise break the UI.
 */
function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function useOpenAPI(app: Axiomify, options: SwaggerPluginOptions): void {
  // Default the prefix so an omitted `routePrefix` doesn't register routes
  // at the literal path "undefined/openapi.json". Also normalise trailing
  // slashes so "/docs" and "/docs/" behave identically.
  const rawPrefix = options.routePrefix ?? '/docs';
  const normalisedPrefix = rawPrefix.startsWith('/')
    ? rawPrefix
    : `/${rawPrefix}`;
  const prefix = normalisedPrefix.endsWith('/')
    ? normalisedPrefix.slice(0, -1)
    : normalisedPrefix;

  const generator = new OpenApiGenerator(app, options);

  let cachedSpec: any = null;

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
      const specUrl = `${prefix}/openapi.json`;

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
