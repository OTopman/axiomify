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

/** Append a value to the Vary header without duplicating existing entries. */
function setVary(res: any, value: string): void {
  if (typeof res.header !== 'function') return;
  if (typeof res.getHeader !== 'function') {
    res.header('Vary', value);
    return;
  }

  const existing = res.getHeader('Vary');

  if (!existing) {
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
  res.header('Vary', next);
}

function setVaryValues(res: any, values: string[]): void {
  if (!values.length) return;
  setVary(res, [...new Set(values)].join(', '));
}

function anchorRegExp(re: RegExp): RegExp {
  let source = re.source;
  if (source.startsWith('^') && source.endsWith('$')) {
    return re;
  }
  console.warn(
    `[axiomify/cors] Warning: RegExp origin ${re.toString()} is not fully anchored. ` +
      `Auto-anchoring it to prevent partial match bypasses (e.g. attacker-domain.com). ` +
      `Please use ^ and $ explicitly, e.g. /^https?:\\/\\/(.*\\.)?domain\\.com$/`,
  );
  if (!source.startsWith('^')) {
    source = '^' + source;
  }
  if (!source.endsWith('$')) {
    source = source + '$';
  }
  return new RegExp(source, re.flags);
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

  // Security (H3, CWE-942): reflect-all (`origin: true`) with credentials is
  // equivalent to `*` with credentials — it lets ANY site make authenticated
  // cross-origin requests and read the responses. Require an explicit
  // allowlist (string/array/RegExp/function) for credentialed CORS.
  if (credentials && origin === true) {
    throw new Error(
      '[axiomify/cors] `credentials: true` cannot be combined with `origin: true` (reflect-all). Specify an explicit origin allowlist.',
    );
  }

  let normalizedOrigin = origin;
  if (origin instanceof RegExp) {
    normalizedOrigin = anchorRegExp(origin);
  } else if (Array.isArray(origin)) {
    normalizedOrigin = origin.map((entry) =>
      entry instanceof RegExp ? anchorRegExp(entry) : entry,
    );
  }

  app.addHook('onRequest', async (req, res) => {
    const requestOrigin = req.headers['origin'] as string | undefined;
    const varyValues: string[] = [];

    let resolvedOrigin: string | undefined;

    if (normalizedOrigin === true) {
      // Security (M6, CWE-346): when reflecting, never echo an absent or
      // literal `null` origin (sandboxed iframes, data:/file: documents),
      // which would otherwise grant those opaque origins access.
      resolvedOrigin =
        requestOrigin && requestOrigin !== 'null' ? requestOrigin : undefined;
    } else if (normalizedOrigin === '*') {
      resolvedOrigin = '*';
    } else if (normalizedOrigin === false) {
      resolvedOrigin = undefined;
    } else if (typeof normalizedOrigin === 'string') {
      if (requestOrigin === normalizedOrigin) resolvedOrigin = normalizedOrigin;
    } else if (normalizedOrigin instanceof RegExp) {
      if (requestOrigin && normalizedOrigin.test(requestOrigin))
        resolvedOrigin = requestOrigin;
    } else if (Array.isArray(normalizedOrigin)) {
      if (requestOrigin) {
        const match = normalizedOrigin.some((entry) =>
          typeof entry === 'string'
            ? entry === requestOrigin
            : entry.test(requestOrigin),
        );
        if (match) resolvedOrigin = requestOrigin;
      }
    } else if (typeof normalizedOrigin === 'function') {
      const allowed = await normalizedOrigin(requestOrigin);
      if (allowed) {
        // With credentials, requestOrigin must be explicit — never '*'.
        resolvedOrigin = credentials ? requestOrigin : (requestOrigin ?? '*');
      }
    }

    if (resolvedOrigin) {
      res.header('Access-Control-Allow-Origin', resolvedOrigin);
      if (resolvedOrigin !== '*') varyValues.push('Origin');
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
        varyValues.push('Access-Control-Request-Headers');
      }

      setVaryValues(res, varyValues);

      if (!preflightContinue) {
        res.status(optionsSuccessStatus).send(null);
      }
      return;
    }

    setVaryValues(res, varyValues);

    // Access-Control-Allow-Methods is a preflight-only header.
    // Do NOT send it on every non-OPTIONS response — it is meaningless
    // outside a preflight context and adds unnecessary response bloat.
  });
}
