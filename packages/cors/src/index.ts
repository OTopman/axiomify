import type { Axiomify } from '@axiomify/core';

export interface CorsOptions {
  origin?:
    | boolean
    | string
    | RegExp
    | Array<string | RegExp>
    | ((origin: string | undefined) => boolean | Promise<boolean>);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
  allowPrivateNetwork?: boolean;
  varyOnRequestHeaders?: boolean;
  strictPreflight?: boolean;
}

const VARY_STATE = Symbol.for('axiomify.cors.vary');

/**
 * Append a value to the Vary header without duplicating existing entries.
 * Reads via the public `res.raw` instead of private `_headers` internals.
 */
function setVary(res: any, value: string): void {
  if (typeof res.header !== 'function') return;

  // Read the existing Vary value through the adapter's raw response object
  // rather than accessing private `_headers` which differs across adapters.
  const raw = res.raw;
  const existing =
    (typeof raw?.getHeader === 'function'
      ? raw.getHeader('Vary')
      : undefined) ??
    res[VARY_STATE] ??
    (typeof raw?.getHeaders === 'function' ? raw.getHeaders().vary : undefined);

  if (!existing) {
    res[VARY_STATE] = value;
    res.header('Vary', value);
    return;
  }

  const current = String(existing)
    .split(',')
    .map((item: string) => item.trim())
    .filter(Boolean);

  if (!current.includes(value)) {
    current.push(value);
  }

  const next = current.join(', ');
  res[VARY_STATE] = next;
  res.header('Vary', next);
}

export function useCors(app: Axiomify, options: CorsOptions = {}): void {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders,
    exposedHeaders,
    credentials = false,
    maxAge = 86400,
    preflightContinue = false,
    optionsSuccessStatus = 204,
    allowPrivateNetwork = false,
    varyOnRequestHeaders = true,
    strictPreflight = false,
  } = options;

  if (credentials && origin === '*') {
    throw new Error(
      '[axiomify/cors] `credentials: true` cannot be combined with `origin: "*"`.',
    );
  }

  app.addHook('onRequest', async (req, res) => {
    const requestOrigin = req.headers['origin'] as string | undefined;

    let resolvedOrigin: string | undefined;

    if (origin === true || origin === '*') {
      resolvedOrigin = '*';
    } else if (origin === false) {
      resolvedOrigin = undefined;
    } else if (typeof origin === 'string') {
      if (requestOrigin === origin) resolvedOrigin = origin;
    } else if (origin instanceof RegExp) {
      if (requestOrigin && origin.test(requestOrigin))
        resolvedOrigin = requestOrigin;
    } else if (Array.isArray(origin)) {
      if (requestOrigin) {
        const match = origin.some((entry) =>
          typeof entry === 'string'
            ? entry === requestOrigin
            : entry.test(requestOrigin),
        );
        if (match) resolvedOrigin = requestOrigin;
      }
    } else if (typeof origin === 'function') {
      const allowed = await origin(requestOrigin);
      if (allowed) resolvedOrigin = requestOrigin ?? '*';
    }

    if (resolvedOrigin) {
      res.header('Access-Control-Allow-Origin', resolvedOrigin);
      if (resolvedOrigin !== '*') setVary(res, 'Origin');
    }

    if (credentials) {
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    if (exposedHeaders?.length) {
      res.header('Access-Control-Expose-Headers', exposedHeaders.join(', '));
    }

    if (req.method === 'OPTIONS') {
      if (strictPreflight && !requestOrigin) {
        res.status(400).send({ error: 'Invalid preflight request' });
        return;
      }

      const reqAccessControlHeaders =
        req.headers['access-control-request-headers'];
      const resolvedAllowedHeaders = allowedHeaders?.length
        ? allowedHeaders.join(', ')
        : typeof reqAccessControlHeaders === 'string'
          ? reqAccessControlHeaders
          : 'Content-Type, Authorization';

      res.header('Access-Control-Allow-Methods', methods.join(', '));
      res.header('Access-Control-Allow-Headers', resolvedAllowedHeaders);
      res.header('Access-Control-Max-Age', String(maxAge));

      if (
        allowPrivateNetwork &&
        req.headers['access-control-request-private-network'] === 'true'
      ) {
        res.header('Access-Control-Allow-Private-Network', 'true');
      }

      if (varyOnRequestHeaders && !allowedHeaders?.length) {
        setVary(res, 'Access-Control-Request-Headers');
      }

      if (!preflightContinue) {
        res.status(optionsSuccessStatus).send(null);
      }
      return;
    }

    // Access-Control-Allow-Methods is a preflight-only header.
    // Do NOT send it on every non-OPTIONS response — it is meaningless
    // outside a preflight context and adds unnecessary response bloat.
  });
}
