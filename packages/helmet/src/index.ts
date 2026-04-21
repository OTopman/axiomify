import type { Axiomify, AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';

export interface HelmetOptions {
  /** Configures 'Strict-Transport-Security' header. Default: true (180 days) */
  hsts?: boolean | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean };
  /** Configures 'Content-Security-Policy' header. Default: "default-src 'self'" */
  contentSecurityPolicy?: string | false;
  /** Configures 'X-Content-Type-Options' header. Default: 'nosniff' */
  xContentTypeOptions?: boolean | string;
  /** Configures 'X-Frame-Options' header. Default: 'DENY' */
  xFrameOptions?: boolean | string;
  /** Configures 'X-XSS-Protection' header. Default: '0' (disabled) */
  xXssProtection?: boolean | string;
  /** Configures 'Referrer-Policy' header. Default: 'no-referrer' */
  referrerPolicy?: boolean | string;
  /** Configures 'Permissions-Policy' header. Default: none */
  permissionsPolicy?: string | false;
  /** Configures 'X-Download-Options' header. Default: 'noopen' */
  xDownloadOptions?: boolean | string;
  /** Configures 'X-Permitted-Cross-Domain-Policies' header. Default: 'none' */
  xPermittedCrossDomainPolicies?: boolean | string;
  /** Configures 'X-DNS-Prefetch-Control' header. Default: 'off' */
  xDnsPrefetchControl?: boolean | string;
  /** Configures 'Cross-Origin-Embedder-Policy' header. Default: none */
  crossOriginEmbedderPolicy?: string | false;
  /** Configures 'Cross-Origin-Opener-Policy' header. Default: none */
  crossOriginOpenerPolicy?: string | false;
  /** Configures 'Cross-Origin-Resource-Policy' header. Default: none */
  crossOriginResourcePolicy?: string | false;
  /** List of headers to remove from the response. Default: ['X-Powered-By'] */
  removeHeaders?: string[];
}

export function useHelmet(app: Axiomify, options: HelmetOptions = {}): void {
  const {
    hsts = true,
    contentSecurityPolicy = "default-src 'self'",
    xContentTypeOptions = 'nosniff',
    xFrameOptions = 'DENY',
    xXssProtection = '0',
    referrerPolicy = 'no-referrer',
    permissionsPolicy = 'geolocation=(), microphone=(), camera=()',
    xDownloadOptions = 'noopen',
    xPermittedCrossDomainPolicies = 'none',
    xDnsPrefetchControl = 'off',
    crossOriginEmbedderPolicy,
    crossOriginOpenerPolicy,
    crossOriginResourcePolicy,
    removeHeaders = ['X-Powered-By', 'Server'],
  } = options;

  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    // Standard Security Headers
    if (xContentTypeOptions) res.header('X-Content-Type-Options', typeof xContentTypeOptions === 'string' ? xContentTypeOptions : 'nosniff');
    if (xFrameOptions) res.header('X-Frame-Options', typeof xFrameOptions === 'string' ? xFrameOptions : 'DENY');
    if (xXssProtection) res.header('X-XSS-Protection', typeof xXssProtection === 'string' ? xXssProtection : '0');
    if (referrerPolicy) res.header('Referrer-Policy', typeof referrerPolicy === 'string' ? referrerPolicy : 'no-referrer');
    if (xDownloadOptions) res.header('X-Download-Options', typeof xDownloadOptions === 'string' ? xDownloadOptions : 'noopen');
    if (xPermittedCrossDomainPolicies) res.header('X-Permitted-Cross-Domain-Policies', typeof xPermittedCrossDomainPolicies === 'string' ? xPermittedCrossDomainPolicies : 'none');
    if (xDnsPrefetchControl) res.header('X-DNS-Prefetch-Control', typeof xDnsPrefetchControl === 'string' ? xDnsPrefetchControl : 'off');
    
    if (contentSecurityPolicy) res.header('Content-Security-Policy', contentSecurityPolicy);
    if (permissionsPolicy) res.header('Permissions-Policy', permissionsPolicy);
    if (crossOriginEmbedderPolicy) res.header('Cross-Origin-Embedder-Policy', crossOriginEmbedderPolicy);
    if (crossOriginOpenerPolicy) res.header('Cross-Origin-Opener-Policy', crossOriginOpenerPolicy);
    if (crossOriginResourcePolicy) res.header('Cross-Origin-Resource-Policy', crossOriginResourcePolicy);

    // HSTS
    if (hsts) {
      if (typeof hsts === 'boolean') {
        res.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
      } else {
        const maxAge = hsts.maxAge ?? 15552000;
        const includeSub = hsts.includeSubDomains !== false ? '; includeSubDomains' : '';
        const preload = hsts.preload ? '; preload' : '';
        res.header('Strict-Transport-Security', `max-age=${maxAge}${includeSub}${preload}`);
      }
    }

    // Remove Sensitive Headers
    if (removeHeaders && removeHeaders.length > 0) {
      removeHeaders.forEach(header => res.removeHeader(header));
    }
  });
}
