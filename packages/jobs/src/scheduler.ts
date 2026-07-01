import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Job, JobStorage } from './storage';

export type JobHandler<P = any> = (payload: P) => Promise<void> | void;

/**
 * Strips CR/LF and other control characters from a string before it is written
 * to logs, preventing CRLF log-forging / log-injection (CWE-117).
 */
function sanitizeForLog(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value);
  // Replace CR/LF and other C0/C1 control chars (except keep as single space).
  return str.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}

export interface SchedulerOptions {
  queue: string;
  maxConcurrency: number;
  pollIntervalMs: number;
  lockDurationMs: number;
  defaultRetryDelayMs: number;
  /** Maximum time (ms) a single job handler is allowed to run before being timed out. Default: 30000. */
  jobTimeoutMs: number;
  /** Maximum time (ms) to wait for active workers to drain during stop(). Default: 30000. */
  drainTimeoutMs: number;
  /** Queue to route permanently failed jobs to. */
  dlqQueue?: string;
}

export interface SagaStep {
  name: string;
  run: (context: any) => Promise<any>;
  compensate: (context: any) => Promise<any>;
}

let _tracingEnabled = true;
export function setTracingEnabledForTesting(enabled: boolean) {
  _tracingEnabled = enabled;
}

function getTracerApi(): any | null {
  if (!_tracingEnabled) return null;
  try {
    return require('@opentelemetry/api');
  } catch {
    return null;
  }
}

/**
 * Lightweight cron expression parser.
 * Supports 5-field cron: minute hour day-of-month month day-of-week
 * Field syntax: * | N | N-M | N,M,... | * /N (step)
 */
function matchesCronField(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  // Wildcard
  if (field === '*') return true;

  // Step: */N or N/M
  if (field.includes('/')) {
    const [rangeStr, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;
    if (rangeStr === '*') {
      return value % step === 0;
    }
    const start = parseInt(rangeStr, 10);
    if (isNaN(start)) return false;
    return value >= start && (value - start) % step === 0;
  }

  // List: N,M,...
  if (field.includes(',')) {
    const items = field.split(',').map((s) => s.trim());
    return items.some((item) => matchesCronField(item, value, min, max));
  }

  // Range: N-M
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // Exact: N
  const exact = parseInt(field, 10);
  if (isNaN(exact)) return false;
  return value === exact;
}

/**
 * Checks whether the given date matches a 5-field cron expression.
 */
function matchesCronExpression(pattern: string, date: Date): boolean {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minuteF, hourF, domF, monthF, dowF] = fields;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0=Sun, 6=Sat

  return (
    matchesCronField(minuteF, minute, 0, 59) &&
    matchesCronField(hourF, hour, 0, 23) &&
    matchesCronField(domF, dom, 1, 31) &&
    matchesCronField(monthF, month, 1, 12) &&
    matchesCronField(dowF, dow, 0, 6)
  );
}

export class JobScheduler extends EventEmitter {
  private handlers = new Map<string, JobHandler>();
  private activeWorkers = new Set<string>();
  private running = false;
  private timer?: NodeJS.Timeout;

  // Cron schedule definitions
  private cronTasks: {
    pattern: string;
    name: string;
    payload: any;
    lastRun?: number;
  }[] = [];
  private localCronLocks = new Map<string, number>();

  constructor(
    private storage: JobStorage,
    opts: Partial<SchedulerOptions> = {},
  ) {
    super();
    this.options = {
      queue: opts.queue ?? 'default',
      maxConcurrency: opts.maxConcurrency ?? 5,
      pollIntervalMs: opts.pollIntervalMs ?? 100,
      lockDurationMs: opts.lockDurationMs ?? 30000,
      defaultRetryDelayMs: opts.defaultRetryDelayMs ?? 5000,
      jobTimeoutMs: opts.jobTimeoutMs ?? 30000,
      drainTimeoutMs: opts.drainTimeoutMs ?? 30000,
      dlqQueue: opts.dlqQueue ?? `${opts.queue ?? 'default'}:dlq`,
    };
    // Input validation
    if (this.options.maxConcurrency <= 0) {
      throw new Error('[Axiomify Jobs] maxConcurrency must be greater than 0.');
    }
    if (this.options.pollIntervalMs <= 0) {
      throw new Error('[Axiomify Jobs] pollIntervalMs must be greater than 0.');
    }
  }

  private options: SchedulerOptions;

  /**
   * Register a job handler.
   * Warns if a handler with the same name is being overwritten.
   */
  public register<P = any>(name: string, handler: JobHandler<P>): this {
    if (this.handlers.has(name)) {
      console.warn(`[Axiomify Jobs] Handler "${name}" is being overwritten.`);
    }
    this.handlers.set(name, handler);
    return this;
  }

  /**
   * Enqueue a new job.
   */
  public async enqueue<P = any>(
    name: string,
    payload: P,
    opts: EnqueueOptions = {},
  ): Promise<string> {
    if (!name || typeof name !== 'string') {
      throw new Error('[Axiomify Jobs] Job name must be a non-empty string.');
    }

    const id = randomUUID();

    // Trace context capture using OpenTelemetry API if available
    const api = getTracerApi();
    const traceContext: Record<string, string> = {};
    if (api) {
      api.propagation.inject(api.context.active(), traceContext);
    }

    const job: Job = {
      id,
      queue: this.options.queue,
      name,
      payload,
      status: 'pending',
      priority: opts.priority ?? 0,
      runAt: Date.now() + (opts.delayMs ?? 0),
      attempts: 0,
      maxAttempts: opts.attempts ?? 3,
      traceContext:
        Object.keys(traceContext).length > 0 ? traceContext : undefined,
    };
    await this.storage.save(job);
    return id;
  }

  /**
   * Registers a cron schedule.
   * Supports either:
   * - A numeric string (interval in seconds, e.g. "60")
   * - A standard 5-field cron expression (e.g. "* /5 * * * *")
   */
  public schedule(pattern: string, name: string, payload: any = {}): void {
    this.cronTasks.push({ pattern, name, payload });
  }

  /**
   * Starts the worker processing loop.
   */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  /**
   * Stops the worker processing loop.
   * Waits up to `drainTimeoutMs` for active workers to complete.
   */
  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    // Wait for active workers to complete, with a deadline
    const deadline = Date.now() + this.options.drainTimeoutMs;
    while (this.activeWorkers.size > 0) {
      if (Date.now() >= deadline) {
        console.warn(
          `[Axiomify Jobs] Drain timeout reached (${this.options.drainTimeoutMs}ms). ` +
            `${this.activeWorkers.size} worker(s) still active. Force-stopping.`,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private tick(): void {
    if (!this.running) return;

    this.checkCronSchedules().catch((err) => {
      console.error('[Axiomify Jobs] Cron schedule error:', err);
    });

    if (this.activeWorkers.size >= this.options.maxConcurrency) {
      // Re-schedule when concurrency slots open
      this.timer = setTimeout(() => this.tick(), this.options.pollIntervalMs);
      return;
    }

    this.storage
      .acquireNext(this.options.queue, this.options.lockDurationMs)
      .then((job) => {
        if (job) {
          const workerId = randomUUID();
          this.activeWorkers.add(workerId);
          this.executeJob(job).finally(() => {
            this.activeWorkers.delete(workerId);
            // Use setImmediate to yield to I/O between job picks, preventing event loop starvation
            setImmediate(() => this.tick());
          });
        } else {
          this.timer = setTimeout(
            () => this.tick(),
            this.options.pollIntervalMs,
          );
        }
      })
      .catch((err) => {
        console.error('[Axiomify Jobs] Error acquiring job:', err);
        this.timer = setTimeout(() => this.tick(), this.options.pollIntervalMs);
      });
  }

  private async executeJob(job: Job): Promise<void> {
    this.emit('start', job);
    const handler = this.handlers.get(job.name);
    if (!handler) {
      await this.handleJobFailure(
        job,
        `No handler registered for job "${job.name}"`,
      );
      return;
    }

    const timeoutMs = this.options.jobTimeoutMs;

    const api = getTracerApi();
    if (api) {
      const parentContext = job.traceContext
        ? api.propagation.extract(api.context.active(), job.traceContext)
        : api.context.active();

      const tracer = api.trace.getTracer('axiomify-jobs');
      const span = tracer.startSpan(
        `Job: ${job.name}`,
        {
          kind: api.SpanKind.CONSUMER,
          attributes: {
            'axiomify.job.id': job.id,
            'axiomify.job.name': job.name,
            'axiomify.job.queue': job.queue,
            'axiomify.job.attempts': job.attempts,
          },
        },
        parentContext,
      );

      await api.context.with(
        api.trace.setSpan(parentContext, span),
        async () => {
          try {
            await this.runWithTimeout(
              handler,
              job.payload,
              job.name,
              timeoutMs,
            );
            await this.storage.complete(job.id);
            span.setStatus({ code: api.SpanStatusCode.OK });
            this.emit('completed', job);
          } catch (err: any) {
            const errMsg = err.message || String(err);
            span.recordException(err);
            span.setStatus({ code: api.SpanStatusCode.ERROR, message: errMsg });
            await this.handleJobFailure(job, errMsg);
          } finally {
            span.end();
          }
        },
      );
    } else {
      try {
        await this.runWithTimeout(handler, job.payload, job.name, timeoutMs);
        await this.storage.complete(job.id);
        this.emit('completed', job);
      } catch (err: any) {
        const errMsg = err.message || String(err);
        await this.handleJobFailure(job, errMsg);
      }
    }
  }

  private async handleJobFailure(job: Job, error: string): Promise<void> {
    const nextAttempt = job.attempts + 1;
    if (nextAttempt >= job.maxAttempts) {
      const dlqQueue = this.options.dlqQueue;
      if (dlqQueue) {
        const dlqJob: Job = {
          ...job,
          attempts: nextAttempt,
          status: 'failed',
          error,
          queue: dlqQueue,
          lockedAt: undefined,
          lockExpiresAt: undefined,
        };
        await this.storage.save(dlqJob);
        this.emit('dlq', dlqJob, new Error(error));
      } else {
        await this.storage.fail(job.id, error);
      }
      this.emit('failed', job, new Error(error));
    } else {
      await this.storage.fail(job.id, error, this.options.defaultRetryDelayMs);
      this.emit('retry', job, new Error(error));
    }
  }

  /**
   * Runs a handler with a timeout. If the handler exceeds `timeoutMs`,
   * the promise rejects with a timeout error.
   */
  private async runWithTimeout(
    handler: JobHandler,
    payload: any,
    jobName: string,
    timeoutMs: number,
  ): Promise<void> {
    const res = handler(payload);
    if (!(res instanceof Promise)) return; // Synchronous handler completed

    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `[Axiomify Jobs] Job "${jobName}" exceeded timeout of ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
    });

    try {
      await Promise.race([res, timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }

  /**
   * Checks cron schedules and enqueues matching tasks.
   * Supports both numeric intervals (seconds) and standard 5-field cron expressions.
   */
  private async checkCronSchedules(): Promise<void> {
    const now = Date.now();
    const currentDate = new Date(now);

    for (const task of this.cronTasks) {
      let shouldFire = false;
      const intervalSec = parseInt(task.pattern, 10);
      if (!isNaN(intervalSec) && String(intervalSec) === task.pattern.trim()) {
        if (!task.lastRun || now - task.lastRun >= intervalSec * 1000) {
          shouldFire = true;
        }
      } else {
        if (matchesCronExpression(task.pattern, currentDate)) {
          const currentMinuteStart = now - (now % 60000);
          if (!task.lastRun || task.lastRun < currentMinuteStart) {
            shouldFire = true;
          }
        }
      }

      if (shouldFire) {
        // 5 second lock window to prevent duplicate executions across workers in the same cron slot
        const lockDuration = 5000;
        const acquired = await this.tryAcquireCronLock(
          task.pattern,
          lockDuration,
        );
        if (acquired) {
          task.lastRun = now;
          await this.enqueue(task.name, task.payload);
        }
      }
    }
  }

  private async tryAcquireCronLock(
    pattern: string,
    windowMs: number,
  ): Promise<boolean> {
    const lockKey = `axiomify:cron:lock:${this.options.queue}:${pattern}`;
    if (typeof this.storage.acquireCronLock === 'function') {
      return this.storage.acquireCronLock(lockKey, windowMs);
    }
    return this.acquireLocalCronLock(pattern, windowMs);
  }

  private acquireLocalCronLock(pattern: string, windowMs: number): boolean {
    const now = Date.now();
    const expires = this.localCronLocks.get(pattern) ?? 0;
    if (now >= expires) {
      this.localCronLocks.set(pattern, now + windowMs);
      return true;
    }
    return false;
  }
}

/**
 * Saga Coordinator for complex distributed flows.
 * Compensation functions are auto-registered as job handlers when steps are added.
 */
export class SagaCoordinator {
  private steps: SagaStep[] = [];

  constructor(private scheduler: JobScheduler) {}

  public addStep(
    name: string,
    run: (ctx: any) => Promise<any>,
    compensate: (ctx: any) => Promise<any>,
  ): this {
    this.steps.push({ name, run, compensate });

    // Auto-register compensation handler so that `compensate:X` jobs have handlers
    const compensateName = `compensate:${name}`;
    this.scheduler.register(compensateName, async (payload: any) => {
      await compensate(payload.context);
    });

    return this;
  }

  /**
   * Execute Saga workflow with forward run and compensation rollbacks.
   * On failure, enqueues compensation jobs in reverse order for all completed steps.
   */
  public async execute(
    initialContext: any,
  ): Promise<{ success: boolean; context: any; error?: string }> {
    const executedSteps: { step: SagaStep; result: any }[] = [];
    const context = { ...initialContext };

    for (const step of this.steps) {
      try {
        const result = await step.run(context);
        executedSteps.push({ step, result });
        context[step.name] = result;
      } catch (err: any) {
        const errMsg = err.message || String(err);

        for (let i = executedSteps.length - 1; i >= 0; i--) {
          const finished = executedSteps[i];
          try {
            await this.scheduler.enqueue(`compensate:${finished.step.name}`, {
              context,
              result: finished.result,
            });
          } catch (compErr) {
            // Sanitize the interpolated step name to prevent CRLF log-forging
            // (CWE-117); the Error object is passed separately and rendered
            // safely by the console.
            console.error(
              `[Axiomify Saga] Compensation failed for step "${sanitizeForLog(
                finished.step.name,
              )}":`,
              compErr,
            );
          }
        }

        return { success: false, context, error: errMsg };
      }
    }

    return { success: true, context };
  }
}
