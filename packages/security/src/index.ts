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
  /**
   * Rejects requests whose Content-Length header exceeds this value.
   * ⚠️  This check trusts the Content-Length header, which a client controls.
   * A client using chunked transfer encoding can omit Content-Length entirely
   * and stream an arbitrarily large body past this check.
   * Enforce actual body size limits at the HTTP server or adapter layer
   * (e.g. Express `express.json({ limit })`, Fastify `bodyLimit`).
   */
  maxBodySize?: number;
  /**
   * Enables heuristic SQL injection pattern matching.
   * ⚠️  This is NOT a reliable security control — see detector.ts.
   * Parameterized queries are the only real defense.
   */
  sqlInjectionProtection?: boolean;
  /**
   * Enables heuristic NoSQL injection pattern matching.
   * ⚠️  This is NOT a reliable security control — see detector.ts.
   * Schema validation (Zod) stripping unexpected keys is the real defense.
   */
  noSqlInjectionProtection?: boolean;
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
  botProtection?: boolean;
  blockedUserAgentPatterns?: RegExp[];
  sqlPatterns?: RegExp[];
  noSqlPatterns?: RegExp[];
}

function patchRequestProperty(req: unknown, key: string, newValue: unknown) {
  Object.defineProperty(req, key, {
    value: newValue,
    writable: true,
    configurable: true,
    enumerable: true,
  });
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
    // Content-Length guard — fast rejection for well-behaved clients.
    // This does NOT protect against chunked transfer encoding; enforce
    // body size limits at the server/adapter layer as well.
    const contentLength = req.headers['content-length'];
    const parsedContentLength =
      typeof contentLength === 'string'
        ? Number.parseInt(contentLength, 10)
        : NaN;

    if (
      Number.isFinite(parsedContentLength) &&
      parsedContentLength > maxBodySize
    ) {
      res.status(413).send(null, 'Payload Too Large');
      return;
    }

    if (botProtection) {
      const userAgent = String(req.headers['user-agent'] ?? '');
      if (isSuspiciousUserAgent(userAgent, blockedUserAgentPatterns)) {
        res.status(403).send(null, 'Forbidden');
        return;
      }
    }

    // Heuristic injection detection — see detector.ts for bypass surface.
    if (
      sqlInjectionProtection &&
      (detectSqlInjection(req.query, sqlPatterns) ||
        detectSqlInjection(req.params, sqlPatterns) ||
        detectSqlInjection(req.body, sqlPatterns))
    ) {
      res.status(403).send(null, 'Forbidden');
      return;
    }

    if (
      noSqlInjectionProtection &&
      (detectNoSqlInjection(req.query, noSqlPatterns) ||
        detectNoSqlInjection(req.params, noSqlPatterns) ||
        detectNoSqlInjection(req.body, noSqlPatterns))
    ) {
      res.status(403).send(null, 'Forbidden');
      return;
    }

    if (hppProtection && req.query && typeof req.query === 'object') {
      patchRequestProperty(req, 'query', normalizeHpp(req.query));
    }

    if (xssProtection || prototypePollutionProtection || nullByteProtection) {
      const sanitizeOptions = {
        xssProtection,
        prototypePollutionProtection,
        nullByteProtection,
      };

      if (req.body)
        patchRequestProperty(
          req,
          'body',
          sanitizeInput(req.body, sanitizeOptions),
        );
      if (req.query)
        patchRequestProperty(
          req,
          'query',
          sanitizeInput(req.query, sanitizeOptions),
        );
      if (req.params)
        patchRequestProperty(
          req,
          'params',
          sanitizeInput(req.params, sanitizeOptions),
        );
    }
  });
}
