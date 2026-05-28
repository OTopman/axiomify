export function safeJsonStringify(value: any): string {
  return JSON.stringify(value, (_, val) => {
    if (typeof val === 'bigint') {
      return val.toString();
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    return val;
  });
}

export function isBinaryData(value: any): boolean {
  if (value === null || value === undefined) return false;
  return (
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array ||
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof File !== 'undefined' && value instanceof File) ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
  );
}
