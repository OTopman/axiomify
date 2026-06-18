/**
 * Studio API — system performance endpoint.
 *
 * Serves real-time CPU, memory, OS, and process statistics.
 * `GET /__studio/api/system`
 */
import type { ServerResponse } from 'node:http';
import os from 'node:os';
import { sendJson } from '../server/http-server';

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

export function handleGetSystem(_req: any, res: ServerResponse): void {
  const memory = process.memoryUsage();
  const uptime = process.uptime();

  const currentUsage = process.cpuUsage();
  const currentTime = Date.now();

  const userDiff = currentUsage.user - lastCpuUsage.user;
  const sysDiff = currentUsage.system - lastCpuUsage.system;
  const timeDiff = currentTime - lastCpuTime;

  const totalDiffMs = (userDiff + sysDiff) / 1000;
  const cpuCount = os.cpus().length || 1;
  const rawCpuPercent =
    timeDiff > 0 ? (totalDiffMs / timeDiff / cpuCount) * 100 : 0;
  const cpuPercent = Math.min(Math.max(rawCpuPercent, 0), 100);

  lastCpuUsage = currentUsage;
  lastCpuTime = currentTime;

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
    cpu: cpuPercent,
    systemMemory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
    systemCpuCount: cpuCount,
  });
}
