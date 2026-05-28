/**
 * Recursively sanitizes plain objects/arrays to strip prototype-pollution keys.
 */
function isPlainObject(val: unknown): boolean {
  if (typeof val !== 'object' || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  if (proto === null) return true;
  return proto.constructor === Object;
}

export function sanitizeInput<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeInput(item)) as T;
  if (!isPlainObject(obj)) return obj;
  const clean: Record<string, unknown> = Object.create(null);
  for (const key in obj as Record<string, unknown>) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      continue;
    }
    clean[key] = sanitizeInput((obj as Record<string, unknown>)[key]);
  }
  return clean as T;
}
