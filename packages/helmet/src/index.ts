import type { Axiomify, AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';

export interface HelmetOptions {
  hsts?: boolean;
  hstsMaxAge?: number;
  hstsIncludeSubDomains?: boolean;
  contentSecurityPolicy?: string | false;
  xContentTypeOptions?: string | false;
  xFrameOptions?: string | false;
  xXssProtection?: string | false;
  referrerPolicy?: string | false;
  permissionsPolicy?: string | false;
}

export function useHelmet(app: Axiomify, options: HelmetOptions = {}): void {
  app.addHook('onRequest', (req: AxiomifyRequest, res: AxiomifyResponse) => {
    if (options.xContentTypeOptions !== false) res.header('X-Content-Type-Options', options.xContentTypeOptions ?? 'nosniff');
    if (options.xFrameOptions !== false) res.header('X-Frame-Options', options.xFrameOptions ?? 'DENY');
    if (options.xXssProtection !== false) res.header('X-XSS-Protection', options.xXssProtection ?? '0');
    if (options.referrerPolicy !== false) res.header('Referrer-Policy', options.referrerPolicy ?? 'strict-origin-when-cross-origin');
    if (options.permissionsPolicy !== false) res.header('Permissions-Policy', options.permissionsPolicy ?? 'geolocation=(), microphone=(), camera=()');
    if (options.contentSecurityPolicy !== false) res.header('Content-Security-Policy', options.contentSecurityPolicy ?? "default-src 'self'");
    
    if (options.hsts) {
      const maxAge = options.hstsMaxAge ?? 15552000;
      const sub = options.hstsIncludeSubDomains !== false ? '; includeSubDomains' : '';
      res.header('Strict-Transport-Security', `max-age=${maxAge}${sub}`);
    }
  });
}
