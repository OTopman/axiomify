import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

export interface CorsOptions {
  /**
   * Configures the **Access-Control-Allow-Origin** CORS header.
   * - `string`: Set to a specific origin (e.g., 'https://example.com') or '*' to allow all.
   * - `string[]`: An array of allowed origins.
   * - `RegExp`: A regular expression to match against the request origin.
   * - `Function`: A custom function `(origin: string | undefined) => boolean | Promise<boolean>`.
   * Default: '*'
   */
  origin?:
    | string
    | string[]
    | RegExp
    | ((origin: string | undefined) => boolean | Promise<boolean>);
  /**
   * Configures the **Access-Control-Allow-Methods** CORS header.
   * Default: ['GET','POST','PUT','PATCH','DELETE','OPTIONS']
   */
  methods?: string[];
  /**
   * Configures the **Access-Control-Allow-Headers** CORS header.
   * Default: ['Content-Type','Authorization']
   */
  allowedHeaders?: string[];
  /**
   * Configures the **Access-Control-Expose-Headers** CORS header.
   */
  exposedHeaders?: string[];
  /**
   * Configures the **Access-Control-Allow-Credentials** CORS header.
   * Default: false
   */
  credentials?: boolean;
  /**
   * Configures the **Access-Control-Max-Age** CORS header in seconds.
   * Default: 86400 (24h)
   */
  maxAge?: number;
  /**
   * Whether to pass the CORS preflight response to the next handler.
   * Default: false (automatically sends 204 No Content)
   */
  preflightContinue?: boolean;
  /**
   * Provides a status code to use for successful OPTIONS requests.
   * Default: 204
   */
  optionsSuccessStatus?: number;
}

export function useCors(app: Axiomify, options: CorsOptions = {}): void {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization'],
    exposedHeaders,
    credentials = false,
    maxAge = 86400,
    preflightContinue = false,
    optionsSuccessStatus = 204,
  } = options;

  if (credentials && origin === '*') {
    throw new Error(
      '[axiomify/cors] `credentials: true` cannot be combined with `origin: "*"`. ' +
        'Provide an explicit origin, an array, or a matcher function.',
    );
  }

  app.addHook('onRequest', async (req, res) => {
    const requestOrigin = req.headers['origin'] as string | undefined;

    let isAllowed = false;
    let resolvedOrigin = '';

    if (origin === '*') {
      isAllowed = true;
      resolvedOrigin = '*';
    } else if (typeof origin === 'string') {
      if (requestOrigin === origin) {
        isAllowed = true;
        resolvedOrigin = origin;
      }
    } else if (Array.isArray(origin)) {
      if (requestOrigin && origin.includes(requestOrigin)) {
        isAllowed = true;
        resolvedOrigin = requestOrigin;
      }
    } else if (origin instanceof RegExp) {
      if (requestOrigin && origin.test(requestOrigin)) {
        isAllowed = true;
        resolvedOrigin = requestOrigin;
      }
    } else if (typeof origin === 'function') {
      const result = await origin(requestOrigin);
      if (result) {
        isAllowed = true;
        resolvedOrigin = requestOrigin || '';
      }
    }

    if (isAllowed && resolvedOrigin) {
      res.header('Access-Control-Allow-Origin', resolvedOrigin);
      if (resolvedOrigin !== '*') {
        res.header('Vary', 'Origin');
      }
    }

    if (credentials) {
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    if (exposedHeaders && exposedHeaders.length > 0) {
      res.header('Access-Control-Expose-Headers', exposedHeaders.join(', '));
    }

    if (req.method === 'OPTIONS') {
      // Preflight
      res.header('Access-Control-Allow-Methods', methods.join(', '));
      res.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      res.header('Access-Control-Max-Age', String(maxAge));

      if (!preflightContinue) {
        res.status(optionsSuccessStatus).send(null);
      }
    } else {
      // Actual Request
      res.header('Access-Control-Allow-Methods', methods.join(', '));
    }
  });
}
