import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

export interface CorsOptions {
  /** Allowed origins. Use '*' to allow all. Default: '*' */
  origin?: string | string[];
  /** Allowed HTTP methods. Default: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] */
  methods?: string[];
  /** Allowed headers. Default: ['Content-Type','Authorization'] */
  allowedHeaders?: string[];
  /** Headers exposed to the browser JS via Access-Control-Expose-Headers. */
  exposedHeaders?: string[];
  /** Whether to allow credentials. Default: false */
  credentials?: boolean;
  /** Max age in seconds for preflight cache. Default: 86400 (24h) */
  maxAge?: number;
}

export function useCors(app: Axiomify, options: CorsOptions = {}): void {
  const origin = options.origin ?? '*';
  const methods = options.methods ?? [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ];
  const allowedHeaders = options.allowedHeaders ?? [
    'Content-Type',
    'Authorization',
  ];
  const exposedHeaders = options.exposedHeaders;
  const credentials = options.credentials ?? false;
  const maxAge = options.maxAge ?? 86400;

  // CORS spec: `Access-Control-Allow-Credentials: true` is incompatible with
  // `Access-Control-Allow-Origin: *`. Every browser rejects the response.
  // Fail fast at startup rather than letting requests silently break.
  if (credentials && origin === '*') {
    throw new Error(
      '[axiomify/cors] `credentials: true` cannot be combined with `origin: "*"`. ' +
        'Provide an explicit origin (string) or an allow-list (string[]).',
    );
  }

  app.addHook('onRequest', (req, res) => {
    const requestOrigin = req.headers['origin'] as string | undefined;

    let resolvedOrigin = '';
    if (Array.isArray(origin)) {
      if (requestOrigin && origin.includes(requestOrigin)) {
        resolvedOrigin = requestOrigin;
      }
    } else {
      resolvedOrigin = origin; // '*' or a single string
    }

    if (resolvedOrigin) {
      res.header('Access-Control-Allow-Origin', resolvedOrigin);
    }
    // The response varies by Origin whenever we pick from an allow-list or
    // echo a single non-wildcard origin — caches need Vary to not mix them.
    if (resolvedOrigin && resolvedOrigin !== '*') {
      res.header('Vary', 'Origin');
    }

    res.header('Access-Control-Allow-Methods', methods.join(', '));
    res.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
    if (exposedHeaders && exposedHeaders.length > 0) {
      res.header('Access-Control-Expose-Headers', exposedHeaders.join(', '));
    }
    if (credentials) res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Max-Age', String(maxAge));
      res.status(204).send(null);
    }
  });
}
