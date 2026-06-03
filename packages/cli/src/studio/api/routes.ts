/**
 * Studio API — routes endpoint.
 *
 * Serves the discovered routes as JSON.
 * `GET /__studio/api/routes`
 */
import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';

export function handleGetRoutes(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  sendJson(res, {
    routes: discovery.routes,
    count: discovery.routes.length,
    discoveredAt: discovery.discoveredAt,
  });
}
