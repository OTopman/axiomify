export interface SanitizerOptions {
  xssProtection?: boolean;
  prototypePollutionProtection?: boolean;
  nullByteProtection?: boolean;
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function sanitizeXss(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
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
