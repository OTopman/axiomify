/**
 * Recursively sanitizes plain objects/arrays to strip prototype-pollution keys.
 */
export function sanitizeInput<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeInput(item)) as T;
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
