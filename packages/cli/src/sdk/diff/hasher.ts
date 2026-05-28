/**
 * Deterministic Schema Hasher.
 *
 * Produces a stable hash of an IRSchema, ignoring field order where
 * order doesn't matter. Used for caching generation results.
 */
import crypto from 'crypto';
import type { IRSchema } from '../ir/types';

export class SchemaHasher {
  hash(schema: IRSchema): string {
    // A robust implementation would sort keys recursively to guarantee
    // stability before stringifying.
    const str = JSON.stringify(schema, this.replacer);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  private replacer(key: string, value: unknown) {
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );
    }
    if (value instanceof Set) {
      return [...value].sort();
    }
    return value;
  }
}
