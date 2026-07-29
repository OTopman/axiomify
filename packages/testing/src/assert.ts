import type { Axiomify, HttpMethod, RouteDefinition } from '@axiomify/core';
import type { ZodTypeAny } from 'zod';

function isZodSchema(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
}

/**
 * Look up a registered route by method + path.
 *
 * Matches the literal registered path first (`/users/:id`), then falls back
 * to router resolution so concrete paths (`/users/42`) also resolve to the
 * route that would serve them.
 */
export function getRoute(
  app: Axiomify,
  method: HttpMethod | Lowercase<HttpMethod>,
  path: string,
): RouteDefinition | undefined {
  const m = method.toUpperCase() as HttpMethod;
  const exact = app.registeredRoutes.find(
    (route) => route.method === m && route.path === path,
  );
  if (exact) return exact;

  const match = app.router.lookup(m, path, Object.create(null));
  if (match && !('error' in match)) return match.route;
  return undefined;
}

/** The subset of the inject result that expectValidResponse reads. */
export interface ValidatableResponse {
  statusCode: number;
  /** The raw value passed to `res.send()` (pre-serializer). */
  data: unknown;
}

/**
 * Assert that a captured response matches the `schema.response` declared on
 * the registered route. Zod-parses the raw data the handler passed to
 * `res.send()` (before the serializer envelope was applied) and throws a
 * rich, readable error on mismatch.
 *
 * Returns the Zod-parsed data on success.
 *
 * @example
 * const res = await client.get('/users/42');
 * expectValidResponse(app, res, { method: 'GET', path: '/users/:id' });
 */
export function expectValidResponse(
  app: Axiomify,
  res: ValidatableResponse,
  target: { method: HttpMethod | Lowercase<HttpMethod>; path: string },
): unknown {
  const method = target.method.toUpperCase() as HttpMethod;
  const route = getRoute(app, method, target.path);
  if (!route) {
    const registered = app.registeredRoutes
      .map((r) => `${r.method} ${r.path}`)
      .join(', ');
    throw new Error(
      `[@axiomify/testing] expectValidResponse: no route registered for ` +
        `${method} ${target.path}. Registered routes: ${registered || '(none)'}.`,
    );
  }

  const response = route.schema?.response;
  if (!response) {
    throw new Error(
      `[@axiomify/testing] expectValidResponse: route ${route.method} ${route.path} ` +
        'declares no schema.response — there is nothing to validate against. ' +
        'Add a response schema to the route definition.',
    );
  }

  let schema: ZodTypeAny;
  if (isZodSchema(response)) {
    schema = response;
  } else {
    const byStatus = (response as Record<number, ZodTypeAny>)[res.statusCode];
    if (!byStatus) {
      const declared = Object.keys(response).join(', ');
      throw new Error(
        `[@axiomify/testing] expectValidResponse: route ${route.method} ${route.path} ` +
          `declares no response schema for status ${res.statusCode} ` +
          `(declared statuses: ${declared}).`,
      );
    }
    schema = byStatus;
  }

  const result = schema.safeParse(res.data);
  if (!result.success) {
    const issues = result.error.issues
      .map(
        (issue) =>
          `  - ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(
      `[@axiomify/testing] Response for ${route.method} ${route.path} ` +
        `(status ${res.statusCode}) does not match schema.response:\n${issues}\n` +
        `Received data: ${JSON.stringify(res.data, null, 2)}`,
    );
  }
  return result.data;
}
