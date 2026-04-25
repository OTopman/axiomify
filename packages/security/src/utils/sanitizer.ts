export interface SanitizerOptions {
  xssProtection?: boolean;
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
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
 */
function sanitizeXss(value: string): string {
  return (
    value
      // <script> blocks (including multiline)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // javascript: URI scheme (plain and whitespace-padded)
      .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '')
      // data: URI scheme (used in <img src="data:text/html,...">)
      .replace(/d\s*a\s*t\s*a\s*:/gi, '')
      // Inline event handlers — tolerates optional whitespace before `=`
      // and optional quotes around the value.
      .replace(/\bon\w+\s*=/gi, '')
      // <iframe>, <object>, <embed>, <base> — common injection vectors
      .replace(/<\s*\/?\s*(iframe|object|embed|base)\b[^>]*>/gi, '')
      // SVG <animate onbegin=...>, <set onend=...> etc.
      .replace(/<\s*\/?\s*svg\b[^>]*>/gi, '')
  );
}

export function sanitizeInput(
  input: unknown,
  options: SanitizerOptions = {
    xssProtection: true,
    prototypePollutionProtection: true,
    nullByteProtection: true,
  },
): unknown {
  if (typeof input === 'string') {
    const withoutNullBytes = options.nullByteProtection
      ? input.replace(/\0/g, '')
      : input;
    return options.xssProtection
      ? sanitizeXss(withoutNullBytes)
      : withoutNullBytes;
  }

  if (Array.isArray(input)) {
    return input.map((value) => sanitizeInput(value, options));
  }

  if (input && typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (options.prototypePollutionProtection && PROTOTYPE_KEYS.has(key))
        continue;
      sanitized[key] = sanitizeInput(value, options);
    }
    return sanitized;
  }

  return input;
}

export function normalizeHpp(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }
  return normalized;
}
