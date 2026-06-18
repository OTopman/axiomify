import type { AppModule } from '@axiomify/core';
import { JobScheduler, SagaCoordinator } from './scheduler';
import {
  JobStorage,
  MemoryJobStorage,
  SQLJobStorage,
  RedisJobStorage,
} from './storage';

export * from './storage';
export * from './scheduler';

export interface JobsModuleOptions {
  queue?: string;
  storage?: 'memory' | 'sql' | 'redis';
  client?: any; // Application Drizzle/Prisma/Redis client
  maxConcurrency?: number;
  pollIntervalMs?: number;
  lockDurationMs?: number;
  /** Maximum time (ms) a single job handler is allowed to run. Default: 30000. */
  jobTimeoutMs?: number;
  /** Maximum time (ms) to wait for active workers to drain during stop(). Default: 30000. */
  drainTimeoutMs?: number;
  /** Queue to route permanently failed jobs to. */
  dlqQueue?: string;
}

/**
 * Axiomify AppModule to register Distributed Jobs worker/scheduler services in DI.
 */
export const jobsModule = (options: JobsModuleOptions = {}): AppModule => ({
  name: 'jobs',
  register: (app, ctx) => {
    let storage: JobStorage;
    if (options.storage === 'sql') {
      storage = new SQLJobStorage(options.client);
    } else if (options.storage === 'redis') {
      storage = new RedisJobStorage(options.client);
    } else {
      storage = new MemoryJobStorage();
    }

    const scheduler = new JobScheduler(storage, {
      queue: options.queue ?? 'default',
      maxConcurrency: options.maxConcurrency ?? 5,
      pollIntervalMs: options.pollIntervalMs ?? 100,
      lockDurationMs: options.lockDurationMs ?? 30000,
      defaultRetryDelayMs: 5000,
      jobTimeoutMs: options.jobTimeoutMs ?? 30000,
      drainTimeoutMs: options.drainTimeoutMs ?? 30000,
      dlqQueue: options.dlqQueue,
    });

    ctx.provide('jobs', scheduler);

    // Stop loops when app closes
    app.addHook('onClose', async () => {
      await scheduler.stop();
    });
  },
});

declare module '@axiomify/core' {
  interface AppServices {
    jobs: JobScheduler;
  }
}
