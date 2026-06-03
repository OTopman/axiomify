/**
 * Studio API — system performance endpoint.
 *
 * Serves real-time CPU, memory, OS, and process statistics.
 * `GET /__studio/api/system`
 */
import type { ServerResponse } from 'node:http';
import os from 'node:os';
import { sendJson } from '../server/http-server';

export function handleGetSystem(_req: any, res: ServerResponse): void {
  const memory = process.memoryUsage();
  const uptime = process.uptime();

  sendJson(res, {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptime,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
    },
    cpu: process.cpuUsage(),
    systemMemory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
    systemCpuCount: os.cpus().length,
  });
}
