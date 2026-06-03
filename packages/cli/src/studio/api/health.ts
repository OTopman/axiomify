/**
 * Studio API — health endpoint.
 *
 * Serves the discovered health check findings as JSON.
 * `GET /__studio/api/health`
 */
import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';

export function handleGetHealth(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  sendJson(res, {
    health: discovery.health,
    discoveredAt: discovery.discoveredAt,
  });
}
