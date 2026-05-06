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
