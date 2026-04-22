import type { Axiomify, AxiomifyRequest } from '@axiomify/core';
import {
  DEFAULT_BLOCKED_UA_PATTERNS,
  DEFAULT_NOSQL_PATTERNS,
  DEFAULT_SQL_PATTERNS,
  detectNoSqlInjection,
  detectSqlInjection,
  isSuspiciousUserAgent,
} from './utils/detector';
import { normalizeHpp, sanitizeInput } from './utils/sanitizer';

export interface SecurityOptions {
  xssProtection?: boolean;
  hppProtection?: boolean;
  maxBodySize?: number;
  sqlInjectionProtection?: boolean;
  noSqlInjectionProtection?: boolean;
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
  botProtection?: boolean;
  blockedUserAgentPatterns?: RegExp[];
  sqlPatterns?: RegExp[];
  noSqlPatterns?: RegExp[];
}

export function useSecurity(
  app: Axiomify,
  options: SecurityOptions = {},
): void {
  const {
    xssProtection = true,
    hppProtection = true,
    maxBodySize = 1024 * 1024,
    sqlInjectionProtection = true,
    noSqlInjectionProtection = true,
    prototypePollutionProtection = true,
    nullByteProtection = true,
    botProtection = true,
    blockedUserAgentPatterns = DEFAULT_BLOCKED_UA_PATTERNS,
    sqlPatterns = DEFAULT_SQL_PATTERNS,
    noSqlPatterns = DEFAULT_NOSQL_PATTERNS,
  } = options;

  app.addHook('onRequest', async (req: AxiomifyRequest, res) => {
    const contentLength = req.headers['content-length'];
    const parsedContentLength =
      typeof contentLength === 'string'
        ? Number.parseInt(contentLength, 10)
        : NaN;

    if (
      Number.isFinite(parsedContentLength) &&
      parsedContentLength > maxBodySize
    ) {
      res.status(413).send({ error: 'Payload Too Large' });
      return;
    }

    if (botProtection) {
      const userAgent = String(req.headers['user-agent'] ?? '');
      if (isSuspiciousUserAgent(userAgent, blockedUserAgentPatterns)) {
        res.status(403).send({ error: 'Suspicious user agent detected' });
        return;
      }
    }

    if (
      sqlInjectionProtection &&
      (detectSqlInjection(req.query, sqlPatterns) ||
        detectSqlInjection(req.params, sqlPatterns) ||
        detectSqlInjection(req.body, sqlPatterns))
    ) {
      res.status(403).send({ error: 'Potential SQL Injection Detected' });
      return;
    }

    if (
      noSqlInjectionProtection &&
      (detectNoSqlInjection(req.query, noSqlPatterns) ||
        detectNoSqlInjection(req.params, noSqlPatterns) ||
        detectNoSqlInjection(req.body, noSqlPatterns))
    ) {
      res.status(403).send({ error: 'Potential NoSQL Injection Detected' });
      return;
    }

    if (hppProtection && req.query && typeof req.query === 'object') {
      Object.defineProperty(req, 'query', {
        value: normalizeHpp(req.query),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    if (xssProtection || prototypePollutionProtection || nullByteProtection) {
      const sanitizeOptions = {
        xssProtection,
        prototypePollutionProtection,
        nullByteProtection,
      };

      if (req.body)
        Object.defineProperty(req, 'body', {
          value: sanitizeInput(req.body, sanitizeOptions),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      if (req.query)
        Object.defineProperty(req, 'query', {
          value: sanitizeInput(req.query, sanitizeOptions),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      if (req.params)
        Object.defineProperty(req, 'params', {
          value: sanitizeInput(req.params, sanitizeOptions),
          writable: true,
          configurable: true,
          enumerable: true,
        });
    }
  });
}
