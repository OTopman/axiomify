import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { MemoryJobStorage } from '../src/storage';
import { JobScheduler, SagaCoordinator, jobsModule, RedisJobStorage } from '../src/index';

describe('Axiomify Distributed Jobs', () => {
  it('should enqueue and process jobs sequentially using memory storage', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'test-queue',
      maxConcurrency: 2,
      pollIntervalMs: 10,
      lockDurationMs: 5000,
      defaultRetryDelayMs: 1000,
    });

    const resultList: string[] = [];
    scheduler.register('say-hello', (payload: any) => {
      resultList.push(`hello ${payload.name}`);
    });

    await scheduler.enqueue('say-hello', { name: 'Alice' });
    await scheduler.enqueue('say-hello', { name: 'Bob' });

    // Start workers
    scheduler.start();

    // Wait for jobs to execute
    await new Promise((resolve) => setTimeout(resolve, 150));

    await scheduler.stop();

    expect(resultList).toContain('hello Alice');
    expect(resultList).toContain('hello Bob');
    expect(resultList.length).toBe(2);
  });

  it('should retry failed jobs up to maxAttempts', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'retry-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    let runs = 0;
    scheduler.register('flaky-job', () => {
      runs += 1;
      throw new Error('failed');
    });

    // Enqueue job with max 3 attempts
    await scheduler.enqueue('flaky-job', {}, { attempts: 3 });

    scheduler.start();

    // Wait for retries
    await new Promise((resolve) => setTimeout(resolve, 200));

    await scheduler.stop();

    expect(runs).toBe(3); // Initial run + 2 retries
    const jobs = await storage.getJobs();
    expect(jobs[0].status).toBe('failed');
  });

  it('should execute Sagas forward and rollback with compensations on failure', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'saga-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    const saga = new SagaCoordinator(scheduler);
    const stepsRun: string[] = [];
    const compensationsRun: string[] = [];

    saga.addStep(
      'step1',
      async (ctx) => {
        stepsRun.push('step1');
        return { success: true };
      },
      async (ctx) => {
        compensationsRun.push('step1-comp');
      }
    );

    saga.addStep(
      'step2',
      async (ctx) => {
        stepsRun.push('step2');
        throw new Error('step2 crash');
      },
      async (ctx) => {
        compensationsRun.push('step2-comp');
      }
    );

    const result = await saga.execute({ orderId: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('step2 crash');

    expect(stepsRun).toEqual(['step1', 'step2']);
    
    // Compensations should be enqueued as job tasks
    const jobs = await storage.getJobs();
    const compJobNames = jobs.map((j) => j.name);
    expect(compJobNames).toContain('compensate:step1');
  });

  it('should register jobs service in core DI container', async () => {
    const app = new Axiomify();
    app.use(jobsModule({ storage: 'memory' }));
    app.build();

    const scheduler = (app as any)._services.get('jobs');
    expect(scheduler).toBeDefined();
    expect(scheduler).toBeInstanceOf(JobScheduler);
  });

  it('should save, acquire, complete, and fail jobs using RedisJobStorage', async () => {
    // 1. Mock Redis client compatible with ioredis/redis@4 signatures
    class MockRedis {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zsets = new Map<string, Map<string, number>>();

      public async get(key: string) { return this.store.get(key) || null; }
      public async set(key: string, value: string) { this.store.set(key, value); }
      public async del(key: string) { this.store.delete(key); }
      
      public async sadd(key: string, member: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(member);
      }
      public async srem(key: string, member: string) {
        this.sets.get(key)?.delete(member);
      }
      public async smembers(key: string) {
        return Array.from(this.sets.get(key) || []);
      }
      
      public async zadd(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
      }
      public async zrem(key: string, member: string) {
        this.zsets.get(key)?.delete(member);
      }
      public async zrangebyscore(key: string, min: number, max: number) {
        const map = this.zsets.get(key);
        if (!map) return [];
        return Array.from(map.entries())
          .filter(([_, score]) => score >= min && score <= max)
          .map(([member]) => member);
      }
      
      public async mget(keys: string[]) {
        return keys.map((k) => this.store.get(k) || null);
      }
    }

    const mockRedis = new MockRedis();
    const storage = new RedisJobStorage(mockRedis);

    // Save job
    const jobItem = {
      id: 'job-redis-1',
      queue: 'test-queue',
      name: 'send-alert',
      payload: { userId: 42 },
      status: 'pending' as const,
      priority: 100,
      runAt: Date.now() - 50,
      attempts: 0,
      maxAttempts: 3,
    };
    await storage.save(jobItem);

    // Get jobs list
    const jobs = await storage.getJobs('test-queue');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-redis-1');

    // Acquire job
    const acquired = await storage.acquireNext('test-queue', 5000);
    expect(acquired).not.toBeNull();
    expect(acquired!.id).toBe('job-redis-1');
    expect(acquired!.status).toBe('running');

    // Fail job with retry
    await storage.fail('job-redis-1', 'Timeout', 1000);
    const retryJob = (await storage.getJobs('test-queue'))[0];
    expect(retryJob.status).toBe('pending');
    expect(retryJob.attempts).toBe(1);
    expect(retryJob.error).toBe('Timeout');

    // Fail job finally
    await storage.fail('job-redis-1', 'Fatal error');
    const finalJob = (await storage.getJobs('test-queue'))[0];
    expect(finalJob.status).toBe('failed');
    expect(finalJob.attempts).toBe(2);

    // Clear
    await storage.clear();
    const emptyJobs = await storage.getJobs('test-queue');
    expect(emptyJobs).toHaveLength(0);
  });

  it('should propagate OpenTelemetry trace contexts when enqueuing and running jobs', async () => {
    // Check if OpenTelemetry API is loadable (mock client handles extraction/injection)
    const api = require('@opentelemetry/api');
    const { W3CTraceContextPropagator } = require('@opentelemetry/core');
    const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');

    // Register provider and propagator globally for the test
    const provider = new NodeTracerProvider();
    provider.register();
    api.propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'telemetry-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    let activeSpanContext: any = null;
    scheduler.register('trace-test', () => {
      const activeSpan = api.trace.getActiveSpan();
      if (activeSpan) {
        activeSpanContext = activeSpan.spanContext();
      }
    });

    const tracer = api.trace.getTracer('test');
    const parentSpan = tracer.startSpan('parent');
    
    await api.context.with(api.trace.setSpan(api.context.active(), parentSpan), async () => {
      await scheduler.enqueue('trace-test', {});
    });
    
    parentSpan.end();

    // Verify traceContext is present
    const jobs = await storage.getJobs();
    expect(jobs[0].traceContext).toBeDefined();
    expect(jobs[0].traceContext?.traceparent).toBeDefined();

    // Start workers to execute job
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    // The handler should have executed under a child span correlated to parent span
    expect(activeSpanContext).not.toBeNull();
    expect(activeSpanContext.traceId).toBe(parentSpan.spanContext().traceId);
    expect(activeSpanContext.spanId).not.toBe(parentSpan.spanContext().spanId);
  });
});
