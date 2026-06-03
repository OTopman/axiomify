/**
 * Studio API — config endpoint.
 *
 * Serves the discovered framework configuration as JSON.
 * `GET /__studio/api/config`
 */
import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';

export function handleGetConfig(
  _req: any,
  res: ServerResponse,
  discovery: StudioDiscoveryResult,
): void {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    const isSensitive = [
      'SECRET',
      'PASSWORD',
      'TOKEN',
      'KEY',
      'AUTH',
      'PASS',
      'CREDENTIAL',
      'PWD',
    ].some((word) => upperKey.includes(word));
    env[key] = isSensitive ? '••••••••' : value;
  }

  sendJson(res, {
    config: discovery.config,
    env,
    discoveredAt: discovery.discoveredAt,
  });
}
