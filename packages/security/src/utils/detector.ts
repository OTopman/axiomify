export interface DetectorOptions {
  sqlPatterns?: RegExp[];
  noSqlPatterns?: RegExp[];
  blockedUserAgentPatterns?: RegExp[];
}

/**
 * @deprecated Removed in v5.0. The regex-based SQL detector was trivially
 * bypassable AND produced false positives on legitimate text. Kept as an
 * empty array so existing imports don't break; will be removed in v6.
 */
export const DEFAULT_SQL_PATTERNS: readonly RegExp[] = [];

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

/**
 * @deprecated Removed in v5.0. Use parameterized queries at the DB layer.
 * Always returns false; kept for one major version to avoid breaking imports.
 */
export function detectSqlInjection(
  _input: unknown,
  _patterns?: readonly RegExp[],
): boolean {
  return false;
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
