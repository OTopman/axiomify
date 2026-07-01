# @axiomify/jobs

A resilient, type-safe distributed queue and workflow coordination engine for Axiomify, featuring concurrent workers, auto-retry delays, SQL/Memory storage backends, Saga transactional orchestrators, and native Studio dashboard metrics integration.

---

## Features

- **Pluggable Storage Adapters**: Built-in support for `MemoryJobStorage`, `SQLJobStorage`, and `RedisJobStorage`. Easily extensible to custom databases or cloud queues.
- **Concurrent Queue Workers**: Configurable max concurrency limits, lease lock timeouts, and polling loops.
- **Resilient Auto-Retry Management**: Automatic retry loops with customized backoff delays. Captures and persists error details and stack traces for debugging.
- **Dead Letter Queue (DLQ)**: Automatically routes permanently failed tasks exceeding attempts to a designated queue namespace for offline inspection.
- **Distributed Cron Locking**: Coordinated scheduling via `acquireCronLock` locks (Redis `SET NX PX`), ensuring exactly one cluster worker fires cron intervals.
- **Saga Transaction Coordinator**: Orchestrates multi-step distributed operations, executing compensating rollback tasks in reverse order if any step fails.
- **Studio Dashboard Console**: Native metrics integration exposing active, pending, completed, and failed tasks, with detailed JSON payload inspection and stack trace logs view.

---

## Installation

```bash
npm install @axiomify/jobs
```

_Note: `@axiomify/core` is required as a peer dependency._

---

## Usage

### 1. Registering the Jobs Module

Register the jobs module in your Axiomify container. The scheduler automatically starts processing loops on adapter start and terminates gracefully on app close.

```typescript
import { Axiomify } from '@axiomify/core';
import { jobsModule } from '@axiomify/jobs';

const app = new Axiomify();

app.use(
  jobsModule({
    queue: 'default',
    storage: 'memory', // Use 'sql' for persistent environments
    maxConcurrency: 5,
    pollIntervalMs: 1000,
  }),
);
```

### 2. Registering and Enqueuing Tasks

Inject the `jobs` scheduler from the dependency container to register task handlers and enqueue background workloads.

```typescript
const jobs = app.resolve('jobs');

// Register a task worker handler
jobs.register(
  'send-welcome-email',
  async (payload: { email: string; name: string }) => {
    console.log(`Sending email to ${payload.name}...`);
    // Async mail operation
  },
);

// Enqueue a background task
await jobs.enqueue(
  'send-welcome-email',
  {
    email: 'user@example.com',
    name: 'John Doe',
  },
  {
    attempts: 3, // max attempts
    priority: 10,
  },
);
```

### 3. Saga Distributed Workflows

For multi-step distributed operations that span multiple microservices or tables, use the `SagaCoordinator` to chain steps together. If any step fails, the coordinator enqueues compensation jobs in reverse order.

```typescript
import { SagaCoordinator } from '@axiomify/jobs';

const saga = new SagaCoordinator(jobs);

// Step 1: Reserve inventory
saga.addStep(
  'reserve-inventory',
  async (ctx) => {
    // Inventory reservation logic
    return { itemId: '123' };
  },
  async (ctx) => {
    // Rollback compensation: release inventory
    await jobs.enqueue('release-inventory', { itemId: '123' });
  },
);

// Step 2: Capture payment (this might throw)
saga.addStep(
  'charge-card',
  async (ctx) => {
    throw new Error('Insufficient funds');
  },
  async (ctx) => {
    // Rollback compensation: refund charge
    await jobs.enqueue('refund-card', { amount: 50 });
  },
);

// Execute the saga flow
const outcome = await saga.execute({ userId: 'user_99' });
console.log(outcome.success); // false
// Compensation 'release-inventory' is automatically enqueued!
```

---

## API Reference

### `jobsModule(options: JobsModuleOptions)`

Axiomify `AppModule` that:

- Instantiates the queue storage engine (`'memory' | 'sql' | 'redis'`).
- Configures `JobScheduler` workers and registers it as a `'jobs'` service in the container.
- Binds shutdown hooks to close background loops gracefully.

Key `options` options:

- `queue`: Queue namespace target (defaults to `'default'`).
- `storage`: Storage backend — `'memory'`, `'sql'`, or `'redis'` (default: `'memory'`).
- `client`: Application storage client (Drizzle/Prisma/Redis) passed to the `'sql'` / `'redis'` backends.
- `maxConcurrency`: Maximum background tasks processed in parallel (default: `5`).
- `pollIntervalMs`: Interval to check for pending jobs (default: `100` ms).
- `lockDurationMs`: Lease lock expiration time in ms (default: `30000` ms).
- `jobTimeoutMs`: Maximum time a single job handler may run before timing out (default: `30000` ms).
- `drainTimeoutMs`: Maximum time `stop()` waits for active workers to drain (default: `30000` ms).
- `dlqQueue`: Queue to route permanently failed jobs to (default: `${queue}:dlq`).

### `JobScheduler` Class

Extends `EventEmitter`.

#### `register<P = any>(name: string, handler: JobHandler<P>): this`

Registers a worker function to execute tasks under the specified name with typed payload `P`. Returns the scheduler instance to support method chaining.

#### `enqueue<P = any>(name: string, payload: P, options?: EnqueueOptions): Promise<string>`

Queues a task for background processing.

- `options.attempts`: Maximum execution retries (default: 3).
- `options.priority`: Task sorting order (higher numbers run first).
- `options.delayMs`: Delay in milliseconds before executing the job.

#### `schedule(pattern: string, name: string, payload?: any): void`

Registers a recurring task or cron schedule. The `pattern` can be a numeric string interval in seconds (e.g., `'60'`) or a standard 5-field cron expression (e.g., `*/5 * * * *`).

#### `start(): void`

Starts the worker polling loops.

#### `stop(): Promise<void>`

Stops polling and waits for active jobs to finish executing.

#### Lifecycle Events

- `start`: Emitted when a job starts execution. Passes `(job: Job)`.
- `completed`: Emitted when a job completes successfully. Passes `(job: Job)`.
- `retry`: Emitted when a job fails and is rescheduled for retry. Passes `(job: Job, error: Error)`.
- `failed`: Emitted when a job fails permanently. Passes `(job: Job, error: Error)`.
- `dlq`: Emitted when a job is routed to the Dead Letter Queue. Passes `(job: Job, error: Error)`.

### `SagaCoordinator` Class

#### `new SagaCoordinator(scheduler: JobScheduler)`

Creates a new coordinator instance.

#### `addStep(name: string, run: (ctx) => Promise<any>, compensate: (ctx) => Promise<any>): this`

Adds an action step and its matching compensation task to the workflow chain. The compensation is auto-registered as a `compensate:<name>` job handler on the scheduler. Returns the coordinator instance for chaining.

#### `execute(initialContext: any): Promise<{ success: boolean; context: any; error?: string }>`

Executes the workflow forwards. If a step throws, enqueues compensation jobs for all preceding completed steps in reverse order and returns `{ success: false, context, error }`.

---

## License

MIT
