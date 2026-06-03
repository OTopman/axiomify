/**
 * Studio API — schemas endpoint.
 *
 * Serves the discovered validation schemas as JSON.
 * `GET /__studio/api/schemas`
 */
import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';

export function handleGetSchemas(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  sendJson(res, {
    schemas: discovery.schemas,
    count: discovery.schemas.length,
    discoveredAt: discovery.discoveredAt,
  });
}
