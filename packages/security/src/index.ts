import type { Axiomify, AxiomifyRequest } from '@axiomify/core';
import {
  DEFAULT_BLOCKED_UA_PATTERNS,
  DEFAULT_NOSQL_PATTERNS,
  detectNoSqlInjection,
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
   * Heuristic NoSQL operator pattern matching. Off by default.
   *
   * Catches the narrow Mongo-style injection where an attacker passes a
   * JSON object containing `$ne`, `$gt`, `$where`, etc. as a field value
   * that would otherwise be a primitive (`{"username": {"$ne": null}}`).
   *
   * The REAL defense is Zod schema validation that rejects unexpected
   * object shapes before they reach the database driver. This option is a
   * supplementary belt-and-braces signal — useful for legacy code without
   * full schema coverage, harmful if you're already validating end-to-end.
   *
   * @default false
   */
  noSqlInjectionProtection?: boolean;
  /**
   * Protect against Prototype Pollution by removing '__proto__', 'prototype',
   * and 'constructor' keys from request body, query, and params.
   * ⚠️ WARNING: This will silently strip these keys from incoming requests.
   * If your API expects legitimate fields with these names (e.g. constructor name
   * in a building materials API), disable this option or handle sanitization manually.
   * @default true
   */
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
  botProtection?: boolean;
  blockedUserAgentPatterns?: RegExp[];
  noSqlPatterns?: RegExp[];
  sanitizerMaxDepth?: number;
}

function patchRequestProperty(
  req: AxiomifyRequest,
  key: keyof AxiomifyRequest,
  newValue: unknown,
) {
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
    // NoSQL operator-key check defaults to OFF — supplementary defense for
    // codebases without full Zod schema coverage; opt-in only.
    noSqlInjectionProtection = false,
    prototypePollutionProtection = true,
    nullByteProtection = true,
    botProtection = true,
    blockedUserAgentPatterns = DEFAULT_BLOCKED_UA_PATTERNS,
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

    // Narrow Mongo-style operator-key check, opt-in. See detector.ts
    // and the option doc for why this is not a primary defense.
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
