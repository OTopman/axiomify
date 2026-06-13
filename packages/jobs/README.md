# @axiomify/jobs

A resilient, type-safe distributed queue and workflow coordination engine for Axiomify, featuring concurrent workers, auto-retry delays, SQL/Memory storage backends, Saga transactional orchestrators, and native Studio dashboard metrics integration.

---

## Features

- **Pluggable Storage Adapters**: Built-in support for `MemoryJobStorage` and `SQLJobStorage` (compatible with Knex, Drizzle, Prisma, or native drivers). Easily extensible to Redis or cloud queue adapters.
- **Concurrent Queue Workers**: Configurable max concurrency limits, lease lock timeouts, and polling loops.
- **Resilient Auto-Retry Management**: Automatic retry loops with customized backoff delays. Captures and persists error details and stack traces for debugging.
- **Saga Transaction Coordinator**: Orchestrates multi-step distributed operations, executing compensating rollback tasks in reverse order if any step fails.
- **Studio Dashboard Console**: Native metrics integration exposing active, pending, completed, and failed tasks, with detailed JSON payload inspection and stack trace logs view.

---

## Installation

```bash
npm install @axiomify/jobs
```

*Note: `@axiomify/core` is required as a peer dependency.*

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
  })
);
```

### 2. Registering and Enqueuing Tasks

Inject the `jobs` scheduler from the dependency container to register task handlers and enqueue background workloads.

```typescript
const jobs = app.resolve('jobs');

// Register a task worker handler
jobs.register('send-welcome-email', async (payload: { email: string; name: string }) => {
  console.log(`Sending email to ${payload.name}...`);
  // Async mail operation
});

// Enqueue a background task
await jobs.enqueue('send-welcome-email', {
  email: 'user@example.com',
  name: 'John Doe',
}, {
  attempts: 3, // max attempts
  priority: 10,
});
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
  }
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
  }
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
- Instantiates the queue storage engine.
- Configures `JobScheduler` workers and registers it as a `'jobs'` service in the container.
- Binds shutdown hooks to close background loops gracefully.

### `JobScheduler` Class

#### `register(name: string, handler: JobHandler): void`
Registers a worker function to execute tasks under the specified name.

#### `enqueue(name: string, payload: any, options?: EnqueueOptions): Promise<JobItem>`
Queues a task for background processing.
- `options.attempts`: Maximum execution retries (default: 3).
- `options.priority`: Task sorting order (higher numbers run first).
- `options.runAt`: Timestamp in ms to delay job start.

#### `start(): void`
Starts the worker polling loops.

#### `stop(): Promise<void>`
Stops polling and waits for active jobs to finish executing.

### `SagaCoordinator` Class

#### `new SagaCoordinator(scheduler: JobScheduler)`
Creates a new coordinator instance.

#### `addStep(name: string, execute: StepExec, compensate: StepComp): void`
Adds an action step and its matching compensation task to the workflow chain.

#### `execute(initialPayload?: any): Promise<SagaResult>`
Executes the workflow forwards. If a step throws, runs compensations for all preceding steps.

---

## License

MIT
