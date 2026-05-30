export interface DetectorOptions {
  noSqlPatterns?: RegExp[];
  blockedUserAgentPatterns?: RegExp[];
}

/**
 * ⚠️  HEURISTIC ONLY — NOT A RELIABLE NOSQL INJECTION DEFENSE.
 *
 * MongoDB operator injection (`$where`, `$ne`, etc.) is best prevented by
 * schema validation (Zod) that strips unexpected keys before they reach the
 * database driver. These patterns are a supplementary heuristic.
 */
export const DEFAULT_NOSQL_PATTERNS = [
  /\$(?:ne|gt|gte|lt|lte|regex|where|expr|jsonSchema|elemMatch|slice|pull|lookup)\b/i,
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

function isPlainObject(val: unknown): boolean {
  if (typeof val !== 'object' || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  if (proto === null) return true;
  return proto.constructor === Object;
}

export function hasPatternMatch(
  input: unknown,
  patterns: RegExp[],
  depth = 0,
): boolean {
  if (depth > 64) return false;
  if (typeof input === 'string')
    return patterns.some((pattern) => pattern.test(input));
  if (Array.isArray(input))
    return input.some((value) => hasPatternMatch(value, patterns, depth + 1));
  if (input && typeof input === 'object') {
    if (!isPlainObject(input)) return false;
    return Object.entries(input).some(
      ([key, value]) =>
        patterns.some((pattern) => pattern.test(key)) ||
        hasPatternMatch(value, patterns, depth + 1),
    );
  }
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
