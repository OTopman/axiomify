/**
 * Studio WebSocket Route Tester.
 *
 * Provides endpoints for retrieving WebSocket routes and metadata for testing.
 *
 * GET /__studio/api/ws/routes — returns discovered WS routes and their schemas.
 */
import type { ServerResponse, IncomingMessage } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery/types';
import { sendJson } from '../server/http-server';

/**
 * The app server's base URL for WS connections. Set via {@link setAppBaseUrl}
 * when the Studio discovers or is told the app's listen address.
 */
let appBaseUrl = 'http://localhost:3000';

/**
 * Updates the app's base URL so the WS tester can tell the client where
 * to connect for WebSocket routes. Called from the Studio orchestrator.
 */
export function setAppBaseUrl(url: string): void {
  appBaseUrl = url;
}

export function getAppBaseUrl(): string {
  return appBaseUrl;
}

export function handleGetWsRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  const wsRoutes = discovery.routes.filter((r) => r.isWs);
  const schemas = discovery.schemas.filter((s) => s.method === 'WS');

  const routesWithSchemas = wsRoutes.map((route) => {
    const schema = schemas.find((s) => s.path === route.path);
    return {
      ...route,
      protocol: route.realtimeProtocol ?? 'ws',
      schema: schema
        ? {
            message: schema.message,
            query: schema.query,
            params: schema.params,
          }
        : undefined,
    };
  });

  sendJson(res, {
    routes: routesWithSchemas,
    appBaseUrl,
  });
}
