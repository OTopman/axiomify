export interface ValidationErrorEntry {
  location: string;
  field: string;
  reason: string;
  received: unknown;
}

function readPath(source: unknown, dottedPath: string): unknown {
  if (!source || typeof source !== 'object') return undefined;

  let current: unknown = source;
  for (const part of dottedPath.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function extractValidationErrors(
  err: unknown,
  req: unknown,
): ValidationErrorEntry[] {
  const errorObject = err as { errors?: unknown };
  const requestObject = req as Record<string, unknown>;
  const list: ValidationErrorEntry[] = [];

  if (!errorObject?.errors || typeof errorObject.errors !== 'object') {
    return list;
  }

  for (const [location, fieldErrors] of Object.entries(errorObject.errors)) {
    if (!fieldErrors || typeof fieldErrors !== 'object') continue;

    for (const [field, reason] of Object.entries(fieldErrors)) {
      list.push({
        location,
        field,
        reason: String(reason),
        received: readPath(requestObject[location], field),
      });
    }
  }

  return list;
}
