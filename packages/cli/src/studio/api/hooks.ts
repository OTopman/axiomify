/**
 * Studio API — hooks endpoint.
 *
 * Serves the discovered lifecycle hook registrations as JSON.
 * `GET /__studio/api/hooks`
 */
import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';

export function handleGetHooks(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  sendJson(res, {
    hooks: discovery.hooks,
    totalCount: discovery.hooks.reduce((sum, h) => sum + h.count, 0),
    discoveredAt: discovery.discoveredAt,
  });
}
