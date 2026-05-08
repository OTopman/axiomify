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
}

function setIfEnabled(
  res: AxiomifyResponse,
  headerName: string,
  value: boolean | string | undefined,
  fallback: string,
): void {
  if (!value) return;
  res.header(headerName, typeof value === 'string' ? value : fallback);
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
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    // Exact prefix match at a path segment boundary — prevents `/other-docs`
    // or `?ref=/docs` from matching and receiving the permissive Docs CSP.
 
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
        contentSecurityPolicy,
      );
    }

    if (crossOriginEmbedderPolicy) {
      res.header('Cross-Origin-Embedder-Policy', crossOriginEmbedderPolicy);
    }
    if (crossOriginOpenerPolicy) {
      res.header('Cross-Origin-Opener-Policy', crossOriginOpenerPolicy);
    }
    if (crossOriginResourcePolicy) {
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
