import type { AxiomifyRequest } from './types';

/**
 * Normalises a {@link SerializerFn} into a guaranteed single-argument form.
 *
 * Evaluated ONCE at adapter-construction time — never per request.
 * This eliminates the per-request `fn.length` branch and removes the need
 * for every adapter to duplicate this logic.
 *
 * @example
 * // In an adapter constructor:
 * this._serialize = makeSerialize(this.core.serializer);
 *
 * // In the hot-path send():
 * const payload = this._serialize({ data, message, statusCode, isError, req });
 */
export function makeSerialize(
  fn: import('./types').SerializerFn,
): (input: import('./types').SerializerInput) => unknown {
  if (fn.length <= 1) {
    return (input) => (fn as (i: import('./types').SerializerInput) => unknown)(input);
  }
  // 5-argument positional form detected. Emit a one-time warning in non-production
  // environments so developers know to migrate to the object form.
  if (process.env['NODE_ENV'] !== 'production') {
    console.warn(
      '[Axiomify] SerializerFn: the 5-argument positional form ' +
      '(data, message, statusCode, isError, req) is deprecated and will be ' +
      'removed in v6. Migrate to the single-argument object form: ' +
      '({ data, message, statusCode, isError, req }) => ...',
    );
  }
  return (input) =>
    (
      fn as (
        data: unknown,
        message?: string,
        statusCode?: number,
        isError?: boolean,
        req?: AxiomifyRequest,
      ) => unknown
    )(input.data, input.message, input.statusCode, input.isError, input.req);
}
