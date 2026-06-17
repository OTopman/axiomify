/**
 * Route Discovery — extracts and normalises HTTP + WebSocket routes from
 * a loaded Axiomify app instance.
 *
 * Reuses the normalisation logic from the `axiomify routes` CLI command
 * but produces structured {@link DiscoveredRoute} objects instead of
 * terminal-formatted strings.
 */
import type { DiscoveredRoute } from './types';

/**
 * Extracts all registered HTTP and WebSocket routes from the app instance
 * and normalises them into a flat array of {@link DiscoveredRoute} objects.
 */
export function discoverRoutes(app: any): DiscoveredRoute[] {
  const httpRoutes: DiscoveredRoute[] = (app.registeredRoutes ?? []).map(
    (r: any) => normaliseRoute(r, false, undefined),
  );
  const wsRoutes: DiscoveredRoute[] = (app.registeredWsRoutes ?? []).map(
    (r: any) => normaliseRoute(r, true, 'ws'),
  );
  const socketIoRoutes: DiscoveredRoute[] = (
    app.registeredSocketIoRoutes ?? []
  ).map((r: any) => normaliseSocketIoRoute(r));
  return [...httpRoutes, ...wsRoutes, ...socketIoRoutes];
}

function normaliseSocketIoRoute(raw: any): DiscoveredRoute {
  const path = typeof raw.path === 'string' ? raw.path : '/socket.io/';

  return {
    method: 'WS',
    path,
    isWs: true,
    realtimeProtocol: 'socket.io',
    validation: [],
    tags: ['socket.io'],
    operationId:
      typeof raw.operationId === 'string' ? raw.operationId : 'socketIo',
    summary:
      typeof raw.summary === 'string' ? raw.summary : 'Socket.IO endpoint',
    description:
      typeof raw.description === 'string'
        ? raw.description
        : 'Socket.IO connection endpoint attached to the native adapter.',
    deprecated: false,
    pluginCount: 0,
    plugins: [],
    hasResponseSchema: false,
  };
}

function normaliseRoute(
  raw: any,
  isWs: boolean,
  realtimeProtocol: DiscoveredRoute['realtimeProtocol'],
): DiscoveredRoute {
  const validation: string[] = [];
  if (raw.schema?.body) validation.push('body');
  if (raw.schema?.query) validation.push('query');
  if (raw.schema?.params) validation.push('params');
  if (raw.schema?.response) validation.push('response');
  if (raw.schema?.files) validation.push('files');
  if (raw.schema?.message) validation.push('message');

  const s = raw.schema ?? {};

  return {
    method: isWs ? 'WS' : raw.method,
    path: raw.path,
    isWs,
    realtimeProtocol,
    validation,
    tags: Array.isArray(s.tags) ? s.tags : [],
    operationId: typeof s.operationId === 'string' ? s.operationId : undefined,
    summary: typeof s.summary === 'string' ? s.summary : undefined,
    description: typeof s.description === 'string' ? s.description : undefined,
    deprecated: s.deprecated === true,
    timeout:
      typeof raw.timeout === 'number' && raw.timeout > 0
        ? raw.timeout
        : undefined,
    pluginCount: Array.isArray(raw.plugins) ? raw.plugins.length : 0,
    plugins: Array.isArray(raw.plugins)
      ? raw.plugins.map((fn: any) => fn.name || '(anonymous)')
      : [],
    hasResponseSchema: !!raw.schema?.response,
  };
}
