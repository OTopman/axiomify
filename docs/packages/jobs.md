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
- `RedisJobStorage`

## Key options

- `queue`: Queue namespace target (defaults to `'default'`)
- `storage`: Choice of storage engine (`'memory' | 'sql' | 'redis'`)
- `client`: Database client instance required if using `'sql'` or `'redis'` storage (compatible with Knex, Drizzle, Prisma, or native Postgres/MySQL connection drivers, or Redis clients)
- `maxConcurrency`: Maximum background tasks processed in parallel per worker process (defaults to `5`)
- `pollIntervalMs`: Polling loop interval in milliseconds to check for pending jobs (defaults to `100` ms)
- `lockDurationMs`: Lease duration in milliseconds for locked tasks before they auto-expire and are made available for retry (defaults to `30000` ms)
- `jobTimeoutMs`: Maximum execution time in milliseconds allowed for a single job handler (defaults to `30000` ms)
- `drainTimeoutMs`: Maximum time in milliseconds to wait for active workers to drain when calling `.stop()` (defaults to `30000` ms)
- `dlqQueue`: Queue to route permanently failed jobs to when they exceed `maxAttempts` (defaults to `${queue}:dlq`)

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
  }),
);

app.use({
  name: 'notifier',
  dependencies: ['jobs'],
  register: (app, ctx) => {
    const jobs = ctx.resolve('jobs');

    // Register job handler
    jobs.register(
      'send-sms',
      async (payload: { phone: string; message: string }) => {
        console.log(`Sending SMS to ${payload.phone}: ${payload.message}`);
      },
    );

    // Route triggering async background job
    app.route({
      method: 'POST',
      path: '/sms',
      handler: async (req, res) => {
        await jobs.enqueue('send-sms', {
          phone: '1234567890',
          message: 'Hello!',
        });
        res.status(202).send({ status: 'queued' });
      },
    });
  },
});
```

## Generics and Typed Payloads

You can specify the structure of the job's payload using TypeScript generics to enable autocompletion and type safety in handlers and enqueue calls:

```typescript
interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

// Handler payload is typed as SendEmailPayload
scheduler.register<SendEmailPayload>('send-email', (payload) => {
  console.log(`Sending email to ${payload.to}`);
});

// Enqueue enforces SendEmailPayload
await scheduler.enqueue<SendEmailPayload>('send-email', {
  to: 'user@example.com',
  subject: 'Welcome',
  body: 'Hello!',
});
```

## Job Lifecycle Events

`JobScheduler` inherits from `EventEmitter` and emits the following event milestones:

- `start`: Emitted when a job starts execution. Passes `(job: Job)`.
- `completed`: Emitted when a job completes successfully. Passes `(job: Job)`.
- `retry`: Emitted when a job fails but has remaining attempts and is rescheduled for retry. Passes `(job: Job, error: Error)`.
- `failed`: Emitted when a job fails and has exhausted all retry attempts. Passes `(job: Job, error: Error)`.
- `dlq`: Emitted when a job exceeds retry limits and is routed to the Dead Letter Queue. Passes `(job: Job, error: Error)`.

Example:

```typescript
scheduler.on('failed', (job, err) => {
  console.error(`Job ${job.id} (${job.name}) failed permanently:`, err);
});

scheduler.on('dlq', (job) => {
  notifyOnCallTeam(`Job ${job.id} routed to DLQ`);
});
```

## Cron Scheduling

The `JobScheduler` supports scheduling recurring tasks via `scheduler.schedule(pattern, name, payload)`.

- **`pattern`**: Can be a standard 5-field cron expression (e.g. `*/5 * * * *` for every 5 minutes) or a numeric string representing the interval in seconds (e.g. `"60"` for every minute).
- **`name`**: The name of the registered job handler to execute.
- **`payload`**: The optional payload to pass to the job handler.

Example:

```typescript
// Register a clean-up handler
scheduler.register('clean-temp-files', async () => {
  await db.query(
    'DELETE FROM temp_files WHERE created_at < NOW() - INTERVAL 1 DAY',
  );
});

// Schedule to run every hour using standard cron expression
scheduler.schedule('0 * * * *', 'clean-temp-files');

// Schedule to run every 30 seconds using interval string
scheduler.schedule('30', 'clean-temp-files');
```

## Behavior

- **Task Fetch and Lock Lease**: Workers fetch pending tasks from the storage engine and place a time-limited lease lock (`lockExpiresAt`, replacing deprecated `lockedAt`) on them to ensure a single worker execution.
- **Failures and Auto-Retries**: Captured exceptions automatically increment the job attempt count. Failed jobs are rescheduled with retry delays until `maxAttempts` is reached, at which point the final error log is saved.
- **Dead Letter Queue (DLQ)**: Jobs failing beyond `maxAttempts` are automatically moved to a designated DLQ queue (e.g., `default:dlq`), leaving the main queue clean and permitting failed jobs to be stored separately for recovery or auditing.
- **Distributed Cron Locking**: Multi-instance deployments automatically prevent duplicate cron execution. If the storage adapter implements `acquireCronLock` (like `RedisJobStorage` using atomic `SET NX PX`), workers coordinate via a distributed lock, ensuring only one instance fires the cron job during the scheduled interval.
- **Compensating Saga Workflows**: Coordinator chains operations. If a step throws an error, compensating undo jobs are registered and enqueued in reverse order.
- **Studio API Support**: Exposes real-time stats (throughput, pending, completed, failed counts) and job inspector details directly to the Axiomify Studio console.
