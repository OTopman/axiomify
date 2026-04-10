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
  const credentials = options.credentials ?? false;
  const maxAge = options.maxAge ?? 86400;

  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    const requestOrigin = req.headers['origin'] as string | undefined;

    // Resolve the allowed origin for this request
    let resolvedOrigin = '*';
    if (Array.isArray(origin)) {
      resolvedOrigin =
        requestOrigin && origin.includes(requestOrigin)
          ? requestOrigin
          : origin[0];
    } else {
      resolvedOrigin = origin;
    }

    res.header('Access-Control-Allow-Origin', resolvedOrigin);
    res.header('Access-Control-Allow-Methods', methods.join(', '));
    res.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));

    if (credentials) {
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Max-Age', String(maxAge));
      res.status(204).send(null);
    }
  });
}
