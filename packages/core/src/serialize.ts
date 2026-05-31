/**
 * Validates a {@link SerializerFn} at adapter-construction time.
 *
 * The serializer contract is a single-argument synchronous function:
 *
 *   ({ data, message, statusCode, isError, req }) => unknown
 *
 * The legacy 5-argument positional form was deprecated through v5 and is
 * removed in v5.0.0. The validation here is:
 *
 *   1. Reject obvious legacy signatures with `fn.length > 1` so users get a
 *      diagnostic at startup, not a silent miscompile (positional args
 *      would be undefined in the single-arg path).
 *   2. Reject async serializers — a Promise return would JSON.stringify to
 *      `{}` / `[object Promise]` on every response. Probe with a sentinel
 *      input and bail if the result is thenable.
 *
 * Returns a passthrough wrapper so call sites can call `serialize(input)`
 * directly without a runtime arity check on the hot path.
 */
export function makeSerialize(
  fn: import('./types').SerializerFn,
): (input: import('./types').SerializerInput) => unknown {
  // The 5-arg positional form was supported in 4.x and warned through the
  // rc cycle of 5.0. Removed in 5.0.0 stable — keeping it longer accreted
  // the kind of permanent technical debt that bedevils long-lived
  // frameworks (Express @1.x still pays this cost in 2026).
  if (fn.length > 1) {
    throw new Error(
      '[Axiomify] SerializerFn must accept a single SerializerInput argument. ' +
        'The 5-argument positional form (data, message, statusCode, isError, req) ' +
        'was removed in v5.0.0. Migrate to:\n' +
        '  ({ data, message, statusCode, isError, req }) => ...\n' +
        'See CHANGELOG.md → 5.0.0 → Breaking changes.',
    );
  }

  const normalized = (input: import('./types').SerializerInput) =>
    (fn as (i: import('./types').SerializerInput) => unknown)(input);

  // Reject async serializers at adapter-construction time. A Promise return
  // would be JSON.stringify'd as `{}` or `[object Promise]` on the hot path
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
