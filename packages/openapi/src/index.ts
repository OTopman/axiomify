import type { Axiomify } from '@axiomify/core';
import { OpenApiGenerator, OpenApiOptions } from './generator';

export interface SwaggerPluginOptions extends OpenApiOptions {
  routePrefix?: string; // e.g., '/docs'
}

export function useOpenAPI(app: Axiomify, options: SwaggerPluginOptions): void {
  const prefix = options.routePrefix?.endsWith('/')
    ? options.routePrefix.slice(0, -1)
    : options.routePrefix;
  const generator = new OpenApiGenerator(app, options);

  let cachedSpec: any = null;

  // 1. Serve the raw OpenAPI JSON
  app.route({
    method: 'GET',
    path: `${prefix}/openapi.json`,
    handler: async (req, res) => {
      if (!cachedSpec) {
        cachedSpec = generator.generate();
      }
      // FIX: Use sendRaw and stringify the JSON
      res.status(200).sendRaw(JSON.stringify(cachedSpec), 'application/json');
    },
  });

  // 2. Serve the Swagger UI HTML
  app.route({
    method: 'GET',
    path: `${prefix}`,
    handler: async (req, res) => {
      // FIX: Use the clean prefix instead of req.url to avoid trailing slash bugs
      const cleanPrefix = prefix?.endsWith('/') ? prefix.slice(0, -1) : prefix;
      const specUrl = `${cleanPrefix}/openapi.json`;

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${options.info.title} - API Docs</title>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css" />
        </head>
        <body style="margin: 0; padding: 0;">
          <div id="swagger-ui"></div>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.min.js"></script>
          <script>
            window.onload = () => {
              window.ui = SwaggerUIBundle({
                url: '${specUrl}',
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
