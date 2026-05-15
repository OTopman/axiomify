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
   * (e.g., NativeAdapter `maxBodySize` option).
   */
  maxBodySize?: number;
  /**
   * Heuristic SQL injection pattern matching. Off by default.
   *
   * ⚠️  This is NOT a reliable security control. The patterns are trivially
   * bypassed via comment insertion, case variation, URL encoding, CASE/WHEN
   * syntax, time-based blind injection, etc. In practice the main effect
   * of enabling this on a real API is producing 403 false positives on
   * legitimate JSON payloads that happen to contain the strings
   * (e.g. `{"description": "select all union members from list"}`).
   *
   * Parameterized queries / prepared statements at the database layer are
   * the only real defense. Enable this only as a supplementary logging
   * signal, not as a gate.
   *
   * @default false
   */
  sqlInjectionProtection?: boolean;
  /**
   * Heuristic NoSQL operator pattern matching. Off by default.
   *
   * ⚠️  Not a reliable security control. Schema validation (Zod) that strips
   * unexpected keys before they reach the database driver is the real
   * defense — by the time `$ne` reaches your query, you've already lost.
   * Enabling this also produces false positives on legitimate JSON
   * containing keys like `$ne` for unrelated reasons.
   *
   * @default false
   */
  noSqlInjectionProtection?: boolean;
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
  botProtection?: boolean;
  blockedUserAgentPatterns?: RegExp[];
  sqlPatterns?: RegExp[];
  noSqlPatterns?: RegExp[];
  sanitizerMaxDepth?: number;
}

function patchRequestProperty(req: AxiomifyRequest, key: keyof AxiomifyRequest, newValue: unknown) {
  // Direct assignment. Object.defineProperty would force V8 to drop the
  // request's hidden class and re-derive the inline cache for every subsequent
  // property access on the object — measurable per-request cost.
  //
  // body / query / params are declared writable on the AxiomifyRequest
  // interface (only id / method / url / path / ip / headers are readonly),
  // so a plain `req[key] = newValue` is type-safe and shape-stable across
  // every adapter implementation.
  (req as unknown as Record<string, unknown>)[key as string] = newValue;
}

export function useSecurity(
  app: Axiomify,
  options: SecurityOptions = {},
): void {
  const {
    xssProtection = true,
    hppProtection = true,
    maxBodySize = 1024 * 1024,
    // Heuristic detectors default to OFF. They are bypassable and produce
    // false positives on legitimate JSON. Use as supplementary logging
    // signals (opt-in), not as primary gates.
    sqlInjectionProtection = false,
    noSqlInjectionProtection = false,
    prototypePollutionProtection = true,
    nullByteProtection = true,
    botProtection = true,
    blockedUserAgentPatterns = DEFAULT_BLOCKED_UA_PATTERNS,
    sqlPatterns = DEFAULT_SQL_PATTERNS,
    noSqlPatterns = DEFAULT_NOSQL_PATTERNS,
    sanitizerMaxDepth = 64,
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
        maxDepth: sanitizerMaxDepth,
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
