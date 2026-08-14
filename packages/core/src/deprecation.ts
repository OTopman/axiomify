import type { RouteMiddleware } from './types';

export interface DeprecationOptions {
  /**
   * Timestamp at which the endpoint was deprecated. When omitted, emits the
   * Structured Fields boolean `?1` as defined by RFC 9745.
   */
  deprecatedAt?: Date | string;
  /** Date after which the endpoint may no longer be available (RFC 8594). */
  sunset?: Date | string;
  /** Absolute URL for the replacement endpoint or migration guide. */
  successor?: string;
}

function asDate(value: Date | string, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`[@axiomify/core] Invalid ${name} date.`);
  }
  return date;
}

/**
 * Adds HTTP API lifecycle headers to a route.
 *
 * Pair this middleware with `schema: { deprecated: true }` so OpenAPI clients
 * also see the deprecation, and use `Sunset` only after communicating a
 * migration path to consumers.
 */
export function createDeprecationPlugin(
  options: DeprecationOptions = {},
): RouteMiddleware {
  const deprecation = options.deprecatedAt
    ? `@${Math.floor(asDate(options.deprecatedAt, 'deprecatedAt').getTime() / 1000)}`
    : '?1';
  const sunset = options.sunset
    ? asDate(options.sunset, 'sunset').toUTCString()
    : undefined;

  let successor: string | undefined;
  if (options.successor) {
    try {
      successor = new URL(options.successor).toString();
    } catch {
      throw new Error(
        '[@axiomify/core] Deprecation successor must be an absolute URL.',
      );
    }
  }

  return (_req, res) => {
    res.header('Deprecation', deprecation);
    if (sunset) res.header('Sunset', sunset);
    if (successor) {
      res.header('Link', `<${successor}>; rel="successor-version"`);
    }
  };
}
