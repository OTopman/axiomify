import { randomUUID } from 'node:crypto';
import type { Job, JobStorage } from './storage';

export type JobHandler = (payload: any) => Promise<void> | void;

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}

export interface SagaStep {
  name: string;
  run: (context: any) => Promise<any>;
  compensate: (context: any) => Promise<any>;
}

function getTracerApi(): any | null {
  try {
    return require('@opentelemetry/api');
  } catch {
    return null;
  }
}

export class JobScheduler {
  private handlers = new Map<string, JobHandler>();
  private activeWorkers = new Set<string>();
  private running = false;
  private timer?: NodeJS.Timeout;

  // Cron schedule definitions
  private cronTasks: { pattern: string; name: string; payload: any; lastRun?: number }[] = [];

  constructor(
    private storage: JobStorage,
    private options: {
      queue: string;
      maxConcurrency: number;
      pollIntervalMs: number;
      lockDurationMs: number;
      defaultRetryDelayMs: number;
    } = {
      queue: 'default',
      maxConcurrency: 5,
      pollIntervalMs: 100,
      lockDurationMs: 30000,
      defaultRetryDelayMs: 5000,
    }
  ) {}

  /**
   * Register a job handler.
   */
  public register(name: string, handler: JobHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  /**
   * Enqueue a new job.
   */
  public async enqueue(name: string, payload: any, opts: EnqueueOptions = {}): Promise<string> {
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
      traceContext: Object.keys(traceContext).length > 0 ? traceContext : undefined,
    };
    await this.storage.save(job);
    return id;
  }

  /**
   * Registers a cron schedule.
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
   */
  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    // Wait for active workers to complete
    while (this.activeWorkers.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private tick(): void {
    if (!this.running) return;

    this.checkCronSchedules().catch(() => {});

    if (this.activeWorkers.size >= this.options.maxConcurrency) {
      // Re-schedule when concurrency slots open
      this.timer = setTimeout(() => this.tick(), this.options.pollIntervalMs);
      return;
    }

    this.storage.acquireNext(this.options.queue, this.options.lockDurationMs)
      .then((job) => {
        if (job) {
          const workerId = randomUUID();
          this.activeWorkers.add(workerId);
          this.executeJob(job)
            .finally(() => {
              this.activeWorkers.delete(workerId);
              process.nextTick(() => this.tick());
            });
        } else {
          this.timer = setTimeout(() => this.tick(), this.options.pollIntervalMs);
        }
      })
      .catch((err) => {
        console.error('[Axiomify Jobs] Error acquiring job:', err);
        this.timer = setTimeout(() => this.tick(), this.options.pollIntervalMs);
      });
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      await this.storage.fail(job.id, `No handler registered for job "${job.name}"`);
      return;
    }

    const api = getTracerApi();
    if (api) {
      const parentContext = job.traceContext 
        ? api.propagation.extract(api.context.active(), job.traceContext)
        : api.context.active();

      const tracer = api.trace.getTracer('axiomify-jobs');
      const span = tracer.startSpan(`Job: ${job.name}`, {
        kind: api.SpanKind.CONSUMER,
        attributes: {
          'axiomify.job.id': job.id,
          'axiomify.job.name': job.name,
          'axiomify.job.queue': job.queue,
          'axiomify.job.attempts': job.attempts,
        }
      }, parentContext);

      await api.context.with(api.trace.setSpan(parentContext, span), async () => {
        try {
          const res = handler(job.payload);
          if (res instanceof Promise) await res;
          await this.storage.complete(job.id);
          span.setStatus({ code: api.SpanStatusCode.OK });
        } catch (err: any) {
          const errMsg = err.message || String(err);
          span.recordException(err);
          span.setStatus({ code: api.SpanStatusCode.ERROR, message: errMsg });
          await this.storage.fail(job.id, errMsg, this.options.defaultRetryDelayMs);
        } finally {
          span.end();
        }
      });
    } else {
      try {
        const res = handler(job.payload);
        if (res instanceof Promise) await res;
        await this.storage.complete(job.id);
      } catch (err: any) {
        const errMsg = err.message || String(err);
        await this.storage.fail(job.id, errMsg, this.options.defaultRetryDelayMs);
      }
    }
  }

  private async checkCronSchedules(): Promise<void> {
    const now = Date.now();
    for (const task of this.cronTasks) {
      const intervalSec = parseInt(task.pattern, 10);
      if (!isNaN(intervalSec)) {
        if (!task.lastRun || now - task.lastRun >= intervalSec * 1000) {
          task.lastRun = now;
          await this.enqueue(task.name, task.payload);
        }
      } else {
        const oneMinute = 60000;
        if (!task.lastRun || now - task.lastRun >= oneMinute) {
          task.lastRun = now;
          await this.enqueue(task.name, task.payload);
        }
      }
    }
  }
}

/**
 * Saga Coordinator for complex distributed flows.
 */
export class SagaCoordinator {
  private steps: SagaStep[] = [];

  constructor(private scheduler: JobScheduler) {}

  public addStep(name: string, run: (ctx: any) => Promise<any>, compensate: (ctx: any) => Promise<any>): this {
    this.steps.push({ name, run, compensate });
    return this;
  }

  /**
   * Execute Saga workflow with forward run and compensation rollbacks.
   */
  public async execute(initialContext: any): Promise<{ success: boolean; context: any; error?: string }> {
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
            console.error(`[Axiomify Saga] Compensation failed for step "${finished.step.name}":`, compErr);
          }
        }

        return { success: false, context, error: errMsg };
      }
    }

    return { success: true, context };
  }
}
