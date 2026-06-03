/**
 * Studio API — OpenAPI spec endpoint.
 *
 * Serves the generated OpenAPI 3.1 specification as JSON.
 * `GET /__studio/api/openapi`
 *
 * Returns `null` for the spec if `@axiomify/openapi` is not installed.
 */
import type { ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';

export function handleGetOpenApi(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  if (!discovery.openapi) {
    sendJson(res, {
      available: false,
      message:
        '@axiomify/openapi is not installed. Install it to enable the OpenAPI viewer.',
      discoveredAt: discovery.discoveredAt,
    });
    return;
  }

  sendJson(res, {
    available: true,
    spec: discovery.openapi,
    discoveredAt: discovery.discoveredAt,
  });
}

export function handlePostOpenApiSync(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  if (!discovery.openapi) {
    sendJson(
      res,
      {
        success: false,
        message: 'No OpenAPI spec available to sync. Check if @axiomify/openapi is installed.',
      },
      400,
    );
    return;
  }

  try {
    const filePath = path.resolve(process.cwd(), 'openapi.json');
    fs.writeFileSync(filePath, JSON.stringify(discovery.openapi, null, 2), 'utf8');
    sendJson(res, {
      success: true,
      message: 'Successfully synced OpenAPI specification to openapi.json.',
    });
  } catch (err: any) {
    sendJson(
      res,
      {
        success: false,
        message: `Failed to write openapi.json: ${err.message}`,
      },
      500,
    );
  }
}
