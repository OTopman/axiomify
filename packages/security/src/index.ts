import type { Axiomify, AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';
import filterXSS from 'xss';

export interface SecurityOptions {
  /** Enable XSS protection for body, query, and params. Default: true */
  xssProtection?: boolean;
  /** Enable Parameter Pollution protection. Default: true */
  hppProtection?: boolean;
  /** Max request body size in bytes. Default: 1mb */
  maxBodySize?: number;
  /** SQL Injection detection (Basic pattern matching). Default: true */
  sqlInjectionProtection?: boolean;
  /** Content-Encoding support (compression). Default: true */
  compression?: boolean;
}

/**
 * Advanced security hardening for Axiomify applications.
 */
export function useSecurity(app: Axiomify, options: SecurityOptions = {}): void {
  const {
    xssProtection = true,
    hppProtection = true,
    maxBodySize = 1024 * 1024, // 1MB
    sqlInjectionProtection = true,
  } = options;

  app.addHook('onRequest', async (req, res) => {
    // 1. Request Size Guard
    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength as string, 10) > maxBodySize) {
      res.status(413).send({ error: 'Payload Too Large' });
      return;
    }

    // 2. Parameter Pollution Protection (HPP)
    if (hppProtection && req.query) {
      for (const key in req.query) {
        if (Array.isArray(req.query[key])) {
          // Keep only the last value to prevent pollution
          req.query[key] = (req.query[key] as any[]).pop();
        }
      }
    }

    // 3. SQL Injection Detection (Basic Heuristics)
    if (sqlInjectionProtection) {
      const sqlPatterns = [
        /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
        /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
        /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
        /((\%27)|(\'))union/i,
        /exec(\s|\+)+(s|x)p\w+/i,
      ];

      const checkSqlInjection = (data: any): boolean => {
        if (typeof data === 'string') {
          return sqlPatterns.some((pattern) => pattern.test(data));
        }
        if (typeof data === 'object' && data !== null) {
          return Object.values(data).some((val) => checkSqlInjection(val));
        }
        return false;
      };

      if (checkSqlInjection(req.query) || checkSqlInjection(req.params) || checkSqlInjection(req.body)) {
        res.status(403).send({ error: 'Potential SQL Injection Detected' });
        return;
      }
    }

    // 4. XSS Protection
    if (xssProtection) {
      const sanitize = (data: any): any => {
        if (typeof data === 'string') {
          return filterXSS(data);
        }
        if (Array.isArray(data)) {
          return data.map(sanitize);
        }
        if (typeof data === 'object' && data !== null) {
          const sanitized: any = {};
          for (const key in data) {
            sanitized[key] = sanitize(data[key]);
          }
          return sanitized;
        }
        return data;
      };

      if (req.body) req.body = sanitize(req.body);
      if (req.query) req.query = sanitize(req.query);
      if (req.params) req.params = sanitize(req.params);
    }
  });
}
