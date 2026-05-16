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
  const normalized: (input: import('./types').SerializerInput) => unknown =
    fn.length <= 1
      ? (input) =>
          (fn as (i: import('./types').SerializerInput) => unknown)(input)
      : (input) =>
          (
            fn as (
              data: unknown,
              message?: string,
              statusCode?: number,
              isError?: boolean,
              req?: AxiomifyRequest,
            ) => unknown
          )(input.data, input.message, input.statusCode, input.isError, input.req);

  if (fn.length > 1 && process.env['NODE_ENV'] !== 'production') {
    console.warn(
      '[Axiomify] SerializerFn: the 5-argument positional form ' +
      '(data, message, statusCode, isError, req) is deprecated and will be ' +
      'removed in v6. Migrate to the single-argument object form: ' +
      '({ data, message, statusCode, isError, req }) => ...',
    );
  }

  // Reject async serializers at adapter-construction time. A Promise return
  // would be JSON.stringify'd as "{}" or "[object Promise]" on the hot path
  // — silent body corruption that's almost impossible to debug. Probe with
  // a sentinel input; if the result is thenable, fail fast and loudly.
  const probe = normalized({
    data: null,
    message: undefined,
    statusCode: 200,
    isError: false,
  });
  if (probe && typeof (probe as { then?: unknown }).then === 'function') {
    throw new Error(
      '[Axiomify] SerializerFn must be synchronous. The configured serializer ' +
      'returned a Promise — async serialization would corrupt response bodies ' +
      'because JSON.stringify cannot serialize Promises. If you need to perform ' +
      'async work, do it in a route handler or onPostHandler hook before send().',
    );
  }

  return normalized;
}
