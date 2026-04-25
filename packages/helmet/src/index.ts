import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

export interface HelmetOptions {
  hsts?:
    | boolean
    | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean };
  contentSecurityPolicy?: string | false;
  xContentTypeOptions?: boolean | string;
  xFrameOptions?: boolean | string;
  xXssProtection?: boolean | string;
  referrerPolicy?: boolean | string;
  permissionsPolicy?: string | false;
  xDownloadOptions?: boolean | string;
  xPermittedCrossDomainPolicies?: boolean | string;
  xDnsPrefetchControl?: boolean | string;
  crossOriginEmbedderPolicy?: string | false;
  crossOriginOpenerPolicy?: string | false;
  crossOriginResourcePolicy?: string | false;
  originAgentCluster?: boolean;
  xRobotsTag?: string | false;
  removeHeaders?: string[];
  removePoweredBy?: boolean;
  docsPath?: string | false;
}

const DOCS_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https://validator.swagger.io; worker-src 'self' blob:;";

function setIfEnabled(
  res: AxiomifyResponse,
  headerName: string,
  value: boolean | string | undefined,
  fallback: string,
): void {
  if (!value) return;
  res.header(headerName, typeof value === 'string' ? value : fallback);
}

/**
 * Returns true only when the request path is exactly the docs path or
 * starts with it followed by a `/`. Uses req.path (no query string) and
 * requires the match to be at a segment boundary so `/docs-extra` does NOT
 * match a docsPath of `/docs`.
 */
function isDocsRequest(reqPath: string, docsPath: string | false): boolean {
  if (!docsPath) return false;
  return reqPath === docsPath || reqPath.startsWith(docsPath + '/');
}

export function useHelmet(app: Axiomify, options: HelmetOptions = {}): void {
  const {
    hsts = true,
    contentSecurityPolicy = "default-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    xContentTypeOptions = 'nosniff',
    xFrameOptions = 'DENY',
    xXssProtection = '0',
    referrerPolicy = 'no-referrer',
    permissionsPolicy = 'geolocation=(), microphone=(), camera=()',
    xDownloadOptions = 'noopen',
    xPermittedCrossDomainPolicies = 'none',
    xDnsPrefetchControl = 'off',
    crossOriginEmbedderPolicy = 'require-corp',
    crossOriginOpenerPolicy = 'same-origin',
    crossOriginResourcePolicy = 'same-origin',
    originAgentCluster = true,
    xRobotsTag = 'noindex, nofollow',
    removePoweredBy = true,
    removeHeaders = [
      'X-Powered-By',
      'Server',
      'X-AspNet-Version',
      'X-AspNetMvc-Version',
    ],
    docsPath = '/docs',
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    // Exact prefix match at a path segment boundary — prevents `/other-docs`
    // or `?ref=/docs` from matching and receiving the permissive Docs CSP.
    const isDocPath = isDocsRequest(req.path, docsPath);

    setIfEnabled(res, 'X-Content-Type-Options', xContentTypeOptions, 'nosniff');
    setIfEnabled(res, 'X-Frame-Options', xFrameOptions, 'DENY');
    setIfEnabled(res, 'X-XSS-Protection', xXssProtection, '0');
    setIfEnabled(res, 'Referrer-Policy', referrerPolicy, 'no-referrer');
    setIfEnabled(res, 'X-Download-Options', xDownloadOptions, 'noopen');
    setIfEnabled(
      res,
      'X-Permitted-Cross-Domain-Policies',
      xPermittedCrossDomainPolicies,
      'none',
    );
    setIfEnabled(res, 'X-DNS-Prefetch-Control', xDnsPrefetchControl, 'off');

    if (contentSecurityPolicy) {
      res.header(
        'Content-Security-Policy',
        isDocPath ? DOCS_CSP : contentSecurityPolicy,
      );
    }

    if (crossOriginEmbedderPolicy && !isDocPath) {
      res.header('Cross-Origin-Embedder-Policy', crossOriginEmbedderPolicy);
    }
    if (crossOriginOpenerPolicy && !isDocPath) {
      res.header('Cross-Origin-Opener-Policy', crossOriginOpenerPolicy);
    }
    if (crossOriginResourcePolicy && !isDocPath) {
      res.header('Cross-Origin-Resource-Policy', crossOriginResourcePolicy);
    }

    if (permissionsPolicy)
      res.header('Permissions-Policy', permissionsPolicy.trim());
    if (originAgentCluster) res.header('Origin-Agent-Cluster', '?1');
    if (xRobotsTag) res.header('X-Robots-Tag', xRobotsTag);

    if (hsts) {
      if (typeof hsts === 'boolean') {
        res.header(
          'Strict-Transport-Security',
          'max-age=15552000; includeSubDomains',
        );
      } else {
        const maxAge = hsts.maxAge ?? 15552000;
        const includeSub =
          hsts.includeSubDomains !== false ? '; includeSubDomains' : '';
        const preload = hsts.preload ? '; preload' : '';
        res.header(
          'Strict-Transport-Security',
          `max-age=${maxAge}${includeSub}${preload}`,
        );
      }
    }

    const headersToRemove = removePoweredBy
      ? Array.from(new Set([...removeHeaders, 'X-Powered-By']))
      : removeHeaders;

    headersToRemove.forEach((header) => res.removeHeader(header));
  });
}
