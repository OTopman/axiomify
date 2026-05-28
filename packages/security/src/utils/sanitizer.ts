export interface SanitizerOptions {
  xssProtection?: boolean;
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
  maxDepth?: number;
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * ⚠️  HEURISTIC ONLY — NOT A COMPLETE XSS DEFENSE.
 *
 * This function removes the most common XSS patterns from string values but
 * can be bypassed via HTML entity encoding, SVG injection, CSS injection, and
 * many other vectors. It is a defense-in-depth helper, not a primary control.
 *
 * For production applications that render user-supplied content in HTML, use a
 * dedicated HTML sanitization library (e.g. `sanitize-html`, `DOMPurify` via
 * jsdom) that operates on a real HTML parser with an explicit allow-list.
 *
 * SECURITY: Each pattern is applied in a loop until the output stabilises.
 *
 * WHY A LOOP? A single-pass `.replace()` is bypassable when the pattern
 * matches multi-character sequences. For example, the `<script>` regex applied
 * once to `<scrip<script>t>alert(1)</script>` produces
 * `<script>alert(1)</script>` — a valid script tag. Repeating the replacement
 * until the string stops changing eliminates this class of bypass.
 *
 * Each individual regex is kept narrow on purpose (matching the smallest
 * unsafe unit rather than the whole tag) so that the loop terminates quickly
 * in practice — usually in one or two iterations for benign input, never more
 * than a handful of iterations even for adversarial input.
 *
 * Reference: CWE-20 / CWE-80 / CWE-116; OWASP A1 Injection.
 */
function replaceUntilStable(input: string, pattern: RegExp, replacement: string): string {
  let previous: string;
  do {
    previous = input;
    input = input.replace(pattern, replacement);
  } while (input !== previous);
  return input;
}

function sanitizeXss(value: string): string {
  let s = value;

  // <script> blocks — loop guards against nested/split bypass:
  //   Input:  <scrip<script>is removed</script>t>alert(1)</script>
  //   Pass 1: <script>alert(1)</script>   ← still dangerous
  //   Pass 2: alert(1)                    ← safe
  s = replaceUntilStable(s, /<script\b[^<]*(?:(?!<\/script\s*[^>]*>)<[^<]*)*<\/script\s*[^>]*>/gi, '');

  // javascript: URI scheme — loop guards against:
  //   jajavascript:vascript: → javascript: (after one pass) → '' (after two)
  s = replaceUntilStable(s, /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '');

  // data: URI scheme — loop guards against:
  //   ddata:ata:text/html,<h1>xss</h1> → data:text/html,... → ''
  s = replaceUntilStable(s, /d\s*a\s*t\s*a\s*:/gi, '');

  // Inline event handlers (onclick=, onerror=, etc.)
  // Loop guards against ononclick=click= → onclick= → ''
  s = replaceUntilStable(s, /\bon\w+\s*=/gi, '');

  // <iframe>, <object>, <embed>, <base>
  // Loop guards against <ifr<iframe>ame src=...></iframe>ame src=...>
  s = replaceUntilStable(s, /<\s*\/?\s*(iframe|object|embed|base)\b[^>]*>/gi, '');

  // <svg> (used for event-handler injection via <svg onload=...>)
  // Loop guards against <<svg>svg onload=alert(1)><</svg>/svg>
  s = replaceUntilStable(s, /<\s*\/?\s*svg\b[^>]*>/gi, '');

  return s;
}

function isPlainObject(val: unknown): boolean {
  if (typeof val !== 'object' || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  if (proto === null) return true;
  return proto.constructor === Object;
}

export function sanitizeInput(
  input: unknown,
  options: SanitizerOptions = {
    xssProtection: true,
    prototypePollutionProtection: true,
    nullByteProtection: true,
    maxDepth: 64,
  },
  depth = 0,
): unknown {
  const maxDepth = options.maxDepth ?? 64;
  if (depth > maxDepth) return undefined;

  if (typeof input === 'string') {
    const withoutNullBytes = options.nullByteProtection
      ? input.replace(/\0/g, '')
      : input;
    return options.xssProtection
      ? sanitizeXss(withoutNullBytes)
      : withoutNullBytes;
  }

  if (Array.isArray(input)) {
    return input.map((value) => sanitizeInput(value, options, depth + 1));
  }

  if (input && typeof input === 'object') {
    if (!isPlainObject(input)) return input;
    const sanitized: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(input)) {
      if (options.prototypePollutionProtection && PROTOTYPE_KEYS.has(key))
        continue;
      sanitized[key] = sanitizeInput(value, options, depth + 1);
    }
    return sanitized;
  }

  return input;
}

export function normalizeHpp(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;

  const normalized: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }
  return normalized;
}
