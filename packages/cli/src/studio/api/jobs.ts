/**
 * Studio API — background jobs and queue metrics endpoint.
 *
 * Serves active, pending, completed, and failed jobs from @axiomify/jobs.
 * `GET /__studio/api/jobs`
 */
import type { Axiomify } from '@axiomify/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

export async function handleGetJobs(
  _req: IncomingMessage,
  res: ServerResponse,
  app: Axiomify,
): Promise<void> {
  if (!app) {
    sendJson(res, { available: false, error: 'App not loaded' }, 503);
    return;
  }

  // Resolve the scheduler service from the dependency injection container
  const scheduler = (app as any)._services.get('jobs');
  if (!scheduler) {
    sendJson(res, {
      available: false,
      message:
        'Jobs plugin is not active in the application. To enable, call jobsModule(...) from @axiomify/jobs.',
    });
    return;
  }

  try {
    const jobs = await (scheduler as any).storage.getJobs();

    // Compute aggregations
    const stats = {
      total: jobs.length,
      pending: jobs.filter((j: any) => j.status === 'pending').length,
      running: jobs.filter((j: any) => j.status === 'running').length,
      completed: jobs.filter((j: any) => j.status === 'completed').length,
      failed: jobs.filter((j: any) => j.status === 'failed').length,
      successRate:
        jobs.length > 0
          ? Math.round(
              (jobs.filter((j: any) => j.status === 'completed').length /
                jobs.length) *
                100,
            )
          : 100,
    };

    sendJson(res, {
      available: true,
      jobs,
      stats,
    });
  } catch (err: any) {
    sendJson(
      res,
      {
        available: false,
        error: err.message,
      },
      500,
    );
  }
}
