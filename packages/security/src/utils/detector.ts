export interface DetectorOptions {
  sqlPatterns?: RegExp[];
  noSqlPatterns?: RegExp[];
  blockedUserAgentPatterns?: RegExp[];
}

/**
 * ⚠️  HEURISTIC ONLY — NOT A RELIABLE SQL INJECTION DEFENSE.
 *
 * These patterns catch the most obvious script-kiddie payloads but are
 * trivially bypassed via comment insertion (`union`), case variation,
 * URL encoding, CASE/WHEN syntax, time-based blind injection, and dozens of
 * other techniques.
 *
 * The ONLY reliable defense against SQL injection is parameterized queries /
 * prepared statements at the database layer. These patterns are a supplementary
 * signal (e.g. for logging/alerting), not a security gate.
 */
export const DEFAULT_SQL_PATTERNS = [
  /(?:\bunion\b\s+\bselect\b)/i,
  /(?:\bor\b\s+\d+\s*=\s*\d+)/i,
  /(?:--|\/\*|\*\/|;\s*drop\s+table|\bexec\b\s*\()/i,
  // NOTE: the `select...from` pattern below generates false positives on
  // legitimate JSON payloads containing those words. Disabled by default.
  // /(?:\bselect\b.+\bfrom\b)/i,
];

/**
 * ⚠️  HEURISTIC ONLY — NOT A RELIABLE NOSQL INJECTION DEFENSE.
 *
 * MongoDB operator injection (`$where`, `$ne`, etc.) is best prevented by
 * schema validation (Zod) that strips unexpected keys before they reach the
 * database driver. These patterns are a supplementary heuristic.
 */
export const DEFAULT_NOSQL_PATTERNS = [
  /\$(?:ne|gt|gte|lt|lte|regex|where|expr|jsonSchema)\b/i,
  /\{\s*\$where/i,
];

export const DEFAULT_BLOCKED_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /acunetix/i,
  /nessus/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
];

export function hasPatternMatch(input: unknown, patterns: RegExp[]): boolean {
  if (typeof input === 'string')
    return patterns.some((pattern) => pattern.test(input));
  if (Array.isArray(input))
    return input.some((value) => hasPatternMatch(value, patterns));
  if (input && typeof input === 'object') {
    return Object.entries(input).some(
      ([key, value]) =>
        patterns.some((pattern) => pattern.test(key)) ||
        hasPatternMatch(value, patterns),
    );
  }
  return false;
}

export function detectSqlInjection(
  input: unknown,
  patterns = DEFAULT_SQL_PATTERNS,
): boolean {
  return hasPatternMatch(input, patterns);
}

export function detectNoSqlInjection(
  input: unknown,
  patterns = DEFAULT_NOSQL_PATTERNS,
): boolean {
  return hasPatternMatch(input, patterns);
}

export function isSuspiciousUserAgent(
  userAgent: string | undefined,
  patterns = DEFAULT_BLOCKED_UA_PATTERNS,
): boolean {
  const value = userAgent ?? '';
  return patterns.some((pattern) => pattern.test(value));
}
