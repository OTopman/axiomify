import type { RouteDefinition } from '@axiomify/core';

const SSE_METHOD_PATTERN = /\.\s*sse(?:Init|Send)\s*\(/;

function functionReferencesSse(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  try {
    return SSE_METHOD_PATTERN.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

function sseRouteReason(route: RouteDefinition): string | undefined {
  if (route.sse === true) return 'declares `sse: true`';
  if (functionReferencesSse(route.handler)) {
    return 'handler calls `res.sseInit()` or `res.sseSend()`';
  }
  if (route.plugins?.some(functionReferencesSse)) {
    return 'route plugin calls `res.sseInit()` or `res.sseSend()`';
  }
  return undefined;
}

export function assertNoNativeSseRoutes(
  routes: readonly RouteDefinition[],
): void {
  const offenders = routes
    .map((route) => ({ route, reason: sseRouteReason(route) }))
    .filter(
      (item): item is { route: RouteDefinition; reason: string } =>
        item.reason !== undefined,
    );

  if (offenders.length === 0) return;

  const routeList = offenders
    .slice(0, 5)
    .map(({ route, reason }) => `${route.method} ${route.path} (${reason})`)
    .join(', ');
  const extra =
    offenders.length > 5 ? `, and ${offenders.length - 5} more` : '';

  throw new Error(
    `[Axiomify/native] NativeAdapter does not support Server-Sent Events (SSE). ` +
      `Offending route(s): ${routeList}${extra}. ` +
      'Use @axiomify/http, @axiomify/express, @axiomify/fastify, or @axiomify/hapi for SSE endpoints.',
  );
}
