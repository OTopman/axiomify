import type { Axiomify, AxiomifyRequest } from '@axiomify/core';
import filterXSS from 'xss';

export interface SecurityOptions {
  /** Enable XSS protection for body, query, and params. Default: true */
  xssProtection?: boolean;
  /** Enable HTTP parameter pollution mitigation. Default: true */
  hppProtection?: boolean;
  /** Max request body size in bytes. Default: 1mb */
  maxBodySize?: number;
  /** SQL Injection detection (heuristics). Default: true */
  sqlInjectionProtection?: boolean;
  /** Basic NoSQL injection detection (Mongo operators). Default: true */
  noSqlInjectionProtection?: boolean;
  /** Strip prototype pollution keys such as __proto__, constructor, prototype. Default: true */
  prototypePollutionProtection?: boolean;
  /** Reject requests with null bytes in input. Default: true */
  nullByteProtection?: boolean;
  /** Block suspicious user-agent signatures. Default: true */
  botProtection?: boolean;
  /** Custom UA deny-list patterns for botProtection. */
  blockedUserAgentPatterns?: RegExp[];
}

const SQL_PATTERNS = [
  /(?:\bunion\b\s+\bselect\b)/i,
  /(?:\bor\b\s+\d+\s*=\s*\d+)/i,
  /(?:--|\/\*|\*\/|;\s*drop\s+table|\bexec\b\s*\()/i,
  /(?:\bselect\b.+\bfrom\b)/i,
];

const NOSQL_PATTERNS = [/\$(?:ne|gt|gte|lt|lte|regex|where|expr|jsonSchema)/i, /\{\s*\$where/i];

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const DEFAULT_BLOCKED_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /acunetix/i,
  /nessus/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
];

function hasPatternMatch(input: unknown, patterns: RegExp[]): boolean {
  if (typeof input === 'string') return patterns.some((pattern) => pattern.test(input));
  if (Array.isArray(input)) return input.some((value) => hasPatternMatch(value, patterns));
  if (input && typeof input === 'object') {
    return Object.entries(input).some(
      ([key, value]) =>
        patterns.some((pattern) => pattern.test(key)) || hasPatternMatch(value, patterns),
    );
  }
  return false;
}

function sanitizeAndProtect(input: unknown, options: Pick<SecurityOptions, 'xssProtection' | 'prototypePollutionProtection' | 'nullByteProtection'>): unknown {
  if (typeof input === 'string') {
    const withoutNullBytes = options.nullByteProtection ? input.replace(/\0/g, '') : input;
    return options.xssProtection ? filterXSS(withoutNullBytes) : withoutNullBytes;
  }

  if (Array.isArray(input)) {
    return input.map((value) => sanitizeAndProtect(value, options));
  }

  if (input && typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (options.prototypePollutionProtection && PROTOTYPE_KEYS.has(key)) continue;
      sanitized[key] = sanitizeAndProtect(value, options);
    }
    return sanitized;
  }

  return input;
}

function normalizeHpp(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }
  return normalized;
}

/**
 * Advanced security hardening for Axiomify applications.
 */
export function useSecurity(app: Axiomify, options: SecurityOptions = {}): void {
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
  } = options;

  app.addHook('onRequest', async (req: AxiomifyRequest, res) => {
    const contentLength = req.headers['content-length'];
    const parsedContentLength = typeof contentLength === 'string' ? Number.parseInt(contentLength, 10) : NaN;
    if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBodySize) {
      res.status(413).send({ error: 'Payload Too Large' });
      return;
    }

    if (botProtection) {
      const userAgent = String(req.headers['user-agent'] ?? '');
      if (blockedUserAgentPatterns.some((pattern) => pattern.test(userAgent))) {
        res.status(403).send({ error: 'Suspicious user agent detected' });
        return;
      }
    }

    if (sqlInjectionProtection && (hasPatternMatch(req.query, SQL_PATTERNS) || hasPatternMatch(req.params, SQL_PATTERNS) || hasPatternMatch(req.body, SQL_PATTERNS))) {
      res.status(403).send({ error: 'Potential SQL Injection Detected' });
      return;
    }

    if (noSqlInjectionProtection && (hasPatternMatch(req.query, NOSQL_PATTERNS) || hasPatternMatch(req.params, NOSQL_PATTERNS) || hasPatternMatch(req.body, NOSQL_PATTERNS))) {
      res.status(403).send({ error: 'Potential NoSQL Injection Detected' });
      return;
    }

    if (hppProtection && req.query && typeof req.query === 'object') {
      (req as any).query = normalizeHpp(req.query);
    }

    if (xssProtection || prototypePollutionProtection || nullByteProtection) {
      const sanitizeOptions = { xssProtection, prototypePollutionProtection, nullByteProtection };
      if (req.body) (req as any).body = sanitizeAndProtect(req.body, sanitizeOptions);
      if (req.query) (req as any).query = sanitizeAndProtect(req.query, sanitizeOptions);
      if (req.params) (req as any).params = sanitizeAndProtect(req.params, sanitizeOptions);
    }
  });
}
