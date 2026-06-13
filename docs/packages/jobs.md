# @axiomify/jobs

Resilient, type-safe distributed queue and Saga transaction workflow coordination engine with concurrent background workers and native Studio console integration.

## Install

```bash
npm install @axiomify/jobs
```

## Export

- `jobsModule(options?: JobsModuleOptions)`
- `JobScheduler`
- `SagaCoordinator`
- `MemoryJobStorage`
- `SQLJobStorage`

## Key options

- `queue`: Queue namespace target (defaults to `'default'`)
- `storage`: Choice of storage engine (`'memory' | 'sql'`)
- `client`: Database client instance required if using `'sql'` storage (compatible with Knex, Drizzle, Prisma, or native Postgres/MySQL connection drivers)
- `maxConcurrency`: Maximum background tasks processed in parallel per worker process (defaults to `5`)
- `pollIntervalMs`: Polling loop interval in milliseconds to check for pending jobs (defaults to `100` ms)
- `lockDurationMs`: Lease duration in milliseconds for locked tasks before they auto-expire and are made available for retry (defaults to `30000` ms)

## Example

```ts
import { Axiomify } from '@axiomify/core';
import { jobsModule, SagaCoordinator } from '@axiomify/jobs';

const app = new Axiomify();

app.use(
  jobsModule({
    queue: 'notification-service',
    storage: 'memory',
    maxConcurrency: 3,
    pollIntervalMs: 250,
  })
);

app.use({
  name: 'notifier',
  dependencies: ['jobs'],
  register: (app, ctx) => {
    const jobs = ctx.resolve('jobs');

    // Register job handler
    jobs.register('send-sms', async (payload: { phone: string; message: string }) => {
      console.log(`Sending SMS to ${payload.phone}: ${payload.message}`);
    });

    // Route triggering async background job
    app.route({
      method: 'POST',
      path: '/sms',
      handler: async (req, res) => {
        await jobs.enqueue('send-sms', { phone: '1234567890', message: 'Hello!' });
        res.status(202).send({ status: 'queued' });
      },
    });
  },
});
```

## Behavior

- **Task Fetch and Lock Lease**: Workers fetch pending tasks from the storage engine and place a time-limited lease lock (`lockedAt`, `lockedBy`) on them to ensure a single worker execution.
- **Failures and Auto-Retries**: Captured exceptions automatically increment the job attempt count. Failed jobs are rescheduled with retry delays until `maxAttempts` is reached, at which point the final error log is saved.
- **Compensating Saga Workflows**: Coordinator chains operations. If a step throws an error, compensating undo jobs are registered and enqueued in reverse order.
- **Studio API Support**: Exposes real-time stats (throughput, pending, completed, failed counts) and job inspector details directly to the Axiomify Studio console.
