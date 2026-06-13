import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { MemoryJobStorage } from '../src/storage';
import { JobScheduler, SagaCoordinator, jobsModule, RedisJobStorage, SQLJobStorage, setTracingEnabledForTesting } from '../src/index';

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

  it('should run jobs normally when OpenTelemetry is disabled', async () => {
    setTracingEnabledForTesting(false);
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'no-trace-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    const results: string[] = [];
    scheduler.register('job-no-trace', (payload: any) => {
      results.push(payload.data);
    });

    await scheduler.enqueue('job-no-trace', { data: 'hello' });
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    expect(results).toEqual(['hello']);
    setTracingEnabledForTesting(true);
  });

  it('should run enqueued tasks matching cron intervals', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    scheduler.schedule('1', 'cron-task', { foo: 'bar' });
    
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    const jobs = await storage.getJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0].name).toBe('cron-task');
  });

  it('should log when Saga compensation enqueuing fails', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'saga-fail-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(scheduler, 'enqueue').mockRejectedValue(new Error('Enqueue failed'));

    const saga = new SagaCoordinator(scheduler);
    saga.addStep('step1', async () => ({ ok: true }), async () => {});
    saga.addStep('step2', async () => { throw new Error('Crash'); }, async () => {});

    await saga.execute({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Axiomify Saga] Compensation failed for step "step1":'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('should use Lua lock script when eval function is present on Redis client', async () => {
    class MockRedisWithEval {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zsets = new Map<string, Map<string, number>>();
      public keysCalled = false;

      public async get(key: string) { return this.store.get(key) || null; }
      public async set(key: string, value: string) { this.store.set(key, value); }
      public async del(key: string) { this.store.delete(key); }
      public async sadd(key: string, member: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(member);
      }
      public async srem(key: string, member: string) { this.sets.get(key)?.delete(member); }
      public async smembers(key: string) { return Array.from(this.sets.get(key) || []); }
      public async zadd(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
      }
      public async zrem(key: string, member: string) { this.zsets.get(key)?.delete(member); }
      public async zrangebyscore(key: string, min: number, max: number) {
        const map = this.zsets.get(key);
        if (!map) return [];
        return Array.from(map.entries())
          .filter(([_, score]) => score >= min && score <= max)
          .map(([member]) => member);
      }
      public async mget(keys: string[]) { return keys.map((k) => this.store.get(k) || null); }
      
      public async keys(pattern: string) {
        this.keysCalled = true;
        return Array.from(this.store.keys());
      }

      public async eval(script: string | { script: string; keys: string[]; arguments: string[] }, numkeys?: number, ...args: string[]) {
        let lockKey = '';
        if (typeof script === 'object' && script !== null) {
          lockKey = script.keys[0] || '';
        } else {
          lockKey = args[0] || '';
        }
        const rawJob = this.store.get(lockKey);
        if (rawJob) {
          const job = JSON.parse(rawJob);
          job.status = 'running';
          job.lockedAt = Date.now() + 5000;
          this.store.set(lockKey, JSON.stringify(job));
          return JSON.stringify(job);
        }
        return null;
      }
    }

    const mockRedis = new MockRedisWithEval();
    const storage = new RedisJobStorage(mockRedis);

    const jobItem = {
      id: 'job-lua-1',
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
    
    // Acquire using eval locks
    const acquired = await storage.acquireNext('test-queue', 5000);
    expect(acquired).not.toBeNull();
    expect(acquired!.status).toBe('running');

    await storage.complete('job-lua-1');
    await storage.clear();
    expect(mockRedis.keysCalled).toBe(true);
  });

  it('should use Lua lock script when evalsha is present on Redis client', async () => {
    class MockRedisWithEvalSha {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zsets = new Map<string, Map<string, number>>();
      public keysCalled = false;

      public async get(key: string) { return this.store.get(key) || null; }
      public async set(key: string, value: string) { this.store.set(key, value); }
      public async del(key: string) { this.store.delete(key); }
      public async sadd(key: string, member: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(member);
      }
      public async srem(key: string, member: string) { this.sets.get(key)?.delete(member); }
      public async smembers(key: string) { return Array.from(this.sets.get(key) || []); }
      public async zadd(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
      }
      public async zrem(key: string, member: string) { this.zsets.get(key)?.delete(member); }
      public async zrangebyscore(key: string, min: number, max: number) {
        const map = this.zsets.get(key);
        if (!map) return [];
        return Array.from(map.entries())
          .filter(([_, score]) => score >= min && score <= max)
          .map(([member]) => member);
      }
      public async mget(keys: string[]) { return keys.map((k) => this.store.get(k) || null); }
      
      public async keys(pattern: string) {
        this.keysCalled = true;
        return Array.from(this.store.keys());
      }
      public async evalsha() {}
      public async eval(script: string, numkeys: number, ...args: string[]) {
        const lockKey = args[0] || '';
        const rawJob = this.store.get(lockKey);
        if (rawJob) {
          const job = JSON.parse(rawJob);
          job.status = 'running';
          job.lockedAt = Date.now() + 5000;
          this.store.set(lockKey, JSON.stringify(job));
          return JSON.stringify(job);
        }
        return null;
      }
    }

    const mockRedis = new MockRedisWithEvalSha();
    const storage = new RedisJobStorage(mockRedis);

    const jobItem = {
      id: 'job-lua-sha-1',
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
    
    // Acquire using eval locks
    const acquired = await storage.acquireNext('test-queue', 5000);
    expect(acquired).not.toBeNull();
    expect(acquired!.status).toBe('running');

    await storage.complete('job-lua-sha-1');
  });

  it('should throw when RedisJobStorage is missing client', () => {
    expect(() => new RedisJobStorage(null)).toThrow('[Axiomify Jobs] Redis client is required.');
  });

  it('should support redis client variations (UPPERCASE methods and zadd fallback)', async () => {
    const mockUpperRedis = {
      GET: vi.fn().mockResolvedValue(null),
      SET: vi.fn().mockResolvedValue('OK'),
      DEL: vi.fn().mockResolvedValue(1),
      SADD: vi.fn().mockResolvedValue(1),
      SREM: vi.fn().mockResolvedValue(1),
      SMEMBERS: vi.fn().mockResolvedValue([]),
      ZADD: vi.fn().mockImplementation((key, arg1, arg2) => {
        if (arg2 === undefined) {
          return Promise.resolve(1);
        }
        throw new Error('Use object style');
      }),
      ZREM: vi.fn().mockResolvedValue(1),
      ZRANGEBYSCORE: vi.fn().mockResolvedValue([]),
      MGET: vi.fn().mockResolvedValue([]),
    };

    const storage = new RedisJobStorage(mockUpperRedis);
    const jobItem = {
      id: 'job-1',
      queue: 'q',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };
    await storage.save(jobItem);
    expect(mockUpperRedis.ZADD).toHaveBeenCalled();
  });

  it('should support camelCase Redis methods', async () => {
    const mockCamelRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      sAdd: vi.fn().mockResolvedValue(1),
      sRem: vi.fn().mockResolvedValue(1),
      sMembers: vi.fn().mockResolvedValue([]),
      zAdd: vi.fn().mockResolvedValue(1),
      zRem: vi.fn().mockResolvedValue(1),
      zRangeByScore: vi.fn().mockResolvedValue([]),
      mGet: vi.fn().mockResolvedValue([]),
    };

    const storage = new RedisJobStorage(mockCamelRedis);
    const jobItem = {
      id: 'job-2',
      queue: 'q',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };
    await storage.save(jobItem);
    expect(mockCamelRedis.sAdd).toHaveBeenCalled();
  });

  it('should support Prisma-style SQL clients', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    const storage = new SQLJobStorage(mockPrisma);
    await storage.getJobs('test-queue');
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('should support Drizzle-style / PG-style SQL clients', async () => {
    const mockDrizzle = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const storage = new SQLJobStorage(mockDrizzle);
    await storage.getJobs('test-queue');
    expect(mockDrizzle.query).toHaveBeenCalled();
  });

  it('should support generic execute-style SQL clients', async () => {
    const mockExecute = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const storage = new SQLJobStorage(mockExecute);
    await storage.getJobs('test-queue');
    expect(mockExecute.execute).toHaveBeenCalled();
  });

  it('should throw when unsupported database client is provided', async () => {
    const badClient = {};
    const storage = new SQLJobStorage(badClient);
    await expect(storage.getJobs('test-queue')).rejects.toThrow('Unsupported database client interface');
  });

  it('should throw when constructor is missing client', () => {
    expect(() => new SQLJobStorage(null)).toThrow('SQL client database instance is required.');
  });

  it('should perform CRUD operations on SQLJobStorage', async () => {
    const db = new Map<string, any>();
    const mockPg = {
      query: async (sql: string, params: any[] = []) => {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT ID FROM AXIOMIFY_JOBS') && sqlUpper.includes('WHERE ID =')) {
          const id = params[0];
          const row = db.get(id);
          return row ? [row] : [];
        }
        if (sqlUpper.includes('INSERT INTO AXIOMIFY_JOBS')) {
          const [id, queue, name, payload, status, priority, runAt, attempts, maxAttempts, error, lockedAt] = params;
          const row = { id, queue, name, payload, status, priority, runAt, attempts, maxAttempts, error, lockedAt };
          db.set(id, row);
          return [];
        }
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('SET STATUS =') && sqlUpper.includes('PRIORITY =')) {
          const [status, priority, runAt, attempts, maxAttempts, error, lockedAt, id] = params;
          const existing = db.get(id);
          if (existing) {
            Object.assign(existing, { status, priority, runAt: Number(runAt), attempts, maxAttempts, error, lockedAt });
          }
          return [];
        }
        if (sqlUpper.includes('SELECT * FROM AXIOMIFY_JOBS') && sqlUpper.includes('QUEUE =')) {
          const queue = params[0];
          const now = params[1] ?? Date.now();
          const list = Array.from(db.values()).filter(r => r.queue === queue);
          if (sqlUpper.includes('STATUS = \'PENDING\'')) {
            const eligible = list.filter(r => r.status === 'pending' && Number(r.runAt) <= now)
              .sort((a, b) => b.priority - a.priority);
            return eligible.slice(0, 1);
          }
          return list;
        }
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('SET STATUS = \'RUNNING\'')) {
          const [lockedAt, id] = params;
          const existing = db.get(id);
          if (existing) {
            existing.status = 'running';
            existing.lockedAt = lockedAt;
          }
          return [];
        }
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('SET STATUS = \'COMPLETED\'')) {
          const [id] = params;
          const existing = db.get(id);
          if (existing) {
            existing.status = 'completed';
            existing.lockedAt = null;
          }
          return [];
        }
        if (sqlUpper.includes('SELECT ATTEMPTS, MAXATTEMPTS FROM AXIOMIFY_JOBS') && sqlUpper.includes('WHERE ID =')) {
          const id = params[0];
          const row = db.get(id);
          return row ? [{ attempts: row.attempts, maxAttempts: row.maxAttempts }] : [];
        }
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('SET STATUS = \'PENDING\'') && sqlUpper.includes('ATTEMPTS =')) {
          const [attempts, error, runAt, id] = params;
          const existing = db.get(id);
          if (existing) {
            existing.status = 'pending';
            existing.attempts = attempts;
            existing.error = error;
            existing.runAt = Number(runAt);
            existing.lockedAt = null;
          }
          return [];
        }
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('SET STATUS = \'FAILED\'') && sqlUpper.includes('ATTEMPTS =')) {
          const [attempts, error, id] = params;
          const existing = db.get(id);
          if (existing) {
            existing.status = 'failed';
            existing.attempts = attempts;
            existing.error = error;
            existing.lockedAt = null;
          }
          return [];
        }
        if (sqlUpper.includes('DELETE FROM AXIOMIFY_JOBS')) {
          db.clear();
          return [];
        }
        if (sqlUpper.includes('SELECT * FROM AXIOMIFY_JOBS')) {
          return Array.from(db.values());
        }
        return [];
      }
    };

    interface Job {
      id: string;
      queue: string;
      name: string;
      payload: any;
      status: 'pending' | 'running' | 'completed' | 'failed';
      priority: number;
      runAt: number;
      attempts: number;
      maxAttempts: number;
      error?: string;
      lockedAt?: number;
      traceContext?: Record<string, string>;
    }

    const storage = new SQLJobStorage(mockPg);

    // Save non-existent job with traceContext
    const job: Job = {
      id: 'sql-job-1',
      queue: 'sql-queue',
      name: 'task-1',
      payload: { data: 'hello' },
      status: 'pending',
      priority: 10,
      runAt: Date.now() - 100,
      attempts: 0,
      maxAttempts: 2,
      traceContext: { parentSpanId: '123' }
    };

    await storage.save(job);
    expect(db.has('sql-job-1')).toBe(true);

    // Save existent job (updates it)
    job.priority = 20;
    await storage.save(job);
    expect(db.get('sql-job-1').priority).toBe(20);

    // acquireNext
    const acquired = await storage.acquireNext('sql-queue', 60000);
    expect(acquired).not.toBeNull();
    expect(acquired!.id).toBe('sql-job-1');
    expect(acquired!.traceContext).toEqual({ parentSpanId: '123' });
    expect(acquired!.payload).toEqual({ data: 'hello' });

    // getJobs
    const jobs = await storage.getJobs();
    expect(jobs).toHaveLength(1);

    // complete
    await storage.complete('sql-job-1');
    expect(db.get('sql-job-1').status).toBe('completed');

    // fail with retry
    db.get('sql-job-1').status = 'running';
    db.get('sql-job-1').attempts = 0;
    await storage.fail('sql-job-1', 'err1', 5000);
    expect(db.get('sql-job-1').status).toBe('pending');
    expect(db.get('sql-job-1').attempts).toBe(1);

    // fail finally
    await storage.fail('sql-job-1', 'err2');
    expect(db.get('sql-job-1').status).toBe('failed');

    // clear
    await storage.clear();
    expect(db.size).toBe(0);
  });

  it('should serialize and deserialize primitive payloads in SQLJobStorage', async () => {
    let savedPayload: any = null;
    const mockPg = {
      query: async (sql: string, params: any[] = []) => {
        if (sql.toUpperCase().includes('INSERT INTO AXIOMIFY_JOBS')) {
          savedPayload = params[3];
          return [];
        }
        if (sql.toUpperCase().includes('SELECT * FROM AXIOMIFY_JOBS') && sql.toUpperCase().includes('QUEUE =')) {
          return [{
            id: 'sql-job-2',
            queue: 'sql-queue',
            name: 'task-2',
            payload: savedPayload,
            status: 'pending',
            priority: 10,
            runAt: Date.now() - 100,
            attempts: 0,
            maxAttempts: 2
          }];
        }
        if (sql.toUpperCase().includes('UPDATE AXIOMIFY_JOBS') && sql.toUpperCase().includes('SET STATUS = \'RUNNING\'')) {
          return [];
        }
        return [];
      }
    };
    const storage = new SQLJobStorage(mockPg);
    const job: any = {
      id: 'sql-job-2',
      queue: 'sql-queue',
      name: 'task-2',
      payload: 'my-primitive-string-payload',
      status: 'pending',
      priority: 10,
      runAt: Date.now() - 100,
      attempts: 0,
      maxAttempts: 2,
      traceContext: { parentSpanId: '456' }
    };
    await storage.save(job);
    const acquired = await storage.acquireNext('sql-queue', 60000);
    expect(acquired).not.toBeNull();
    expect(acquired!.payload).toBe('my-primitive-string-payload');
    expect(acquired!.traceContext).toEqual({ parentSpanId: '456' });
  });

  it('should handle non-Error objects thrown in handler when tracing is enabled', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'error-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });
    scheduler.register('throw-string', () => {
      throw 'raw-string-error';
    });
    await scheduler.enqueue('throw-string', {});
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();
    const jobs = await storage.getJobs();
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toBe('raw-string-error');
  });

  it('should handle non-Error objects thrown when tracing is disabled', async () => {
    setTracingEnabledForTesting(false);
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'error-queue-2',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });
    scheduler.register('throw-string-notrace', () => {
      throw 'no-trace-string-error';
    });
    await scheduler.enqueue('throw-string-notrace', {});
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();
    const jobs = await storage.getJobs();
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toBe('no-trace-string-error');
    setTracingEnabledForTesting(true);
  });

  it('should support non-numeric cron patterns and fallback to minute intervals', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-queue-nan',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    scheduler.schedule('*/5 * * * *', 'cron-task-nan', { foo: 'bar' });
    
    const now = Date.now();
    (scheduler as any).cronTasks[0].lastRun = now - 70000;

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await scheduler.stop();

    const jobs = await storage.getJobs();
    expect(jobs.some((j) => j.name === 'cron-task-nan')).toBe(true);
  });

  it('should initialize JobsModule with SQL storage option', () => {
    const app = new Axiomify();
    const mockPg = { query: vi.fn().mockResolvedValue([]) };
    app.use(jobsModule({ storage: 'sql', client: mockPg }));
    app.build();

    const scheduler = (app as any)._services.get('jobs') as JobScheduler;
    expect(scheduler).toBeDefined();
    expect((scheduler as any).storage).toBeInstanceOf(SQLJobStorage);
  });

  it('should initialize JobsModule with Redis storage option', () => {
    const app = new Axiomify();
    const mockRedis = { get: vi.fn() };
    app.use(jobsModule({ storage: 'redis', client: mockRedis }));
    app.build();

    const scheduler = (app as any)._services.get('jobs') as JobScheduler;
    expect(scheduler).toBeDefined();
    expect((scheduler as any).storage).toBeInstanceOf(RedisJobStorage);
  });

  it('should stop scheduler when app closes onClose hook', async () => {
    const app = new Axiomify();
    app.use(jobsModule({ storage: 'memory' }));
    app.build();

    const scheduler = (app as any)._services.get('jobs') as JobScheduler;
    scheduler.start();
    expect((scheduler as any).running).toBe(true);

    await (app.hooks as any).runSafe('onClose', {} as any, {} as any);
    expect((scheduler as any).running).toBe(false);
  });

  it('should wait for active workers to drain when calling stop', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'drain-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    let runComplete = false;
    scheduler.register('long-job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      runComplete = true;
    });

    await scheduler.enqueue('long-job', {});
    scheduler.start();

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((scheduler as any).activeWorkers.size).toBe(1);

    await scheduler.stop();
    expect(runComplete).toBe(true);
    expect((scheduler as any).activeWorkers.size).toBe(0);
  });

  it('should reschedule tick when maxConcurrency is reached', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'concurrency-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    scheduler.register('concurrency-job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await scheduler.enqueue('concurrency-job', {});
    await scheduler.enqueue('concurrency-job', {});

    scheduler.start();

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((scheduler as any).activeWorkers.size).toBe(1);

    (scheduler as any).tick();

    await scheduler.stop();
  });

  it('should log error and reschedule tick when storage.acquireNext rejects', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'fail-acquire-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    vi.spyOn(storage, 'acquireNext').mockRejectedValue(new Error('DB connection lost'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await scheduler.stop();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Axiomify Jobs] Error acquiring job:'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('should execute Sagas successfully and return success status', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage);
    const saga = new SagaCoordinator(scheduler);
    
    saga.addStep('step1', async (ctx) => 'result1', async () => {});
    const result = await saga.execute({ input: 1 });
    
    expect(result.success).toBe(true);
    expect(result.context.step1).toBe('result1');
  });

  it('should remove job from pending zset when saving non-pending job in RedisJobStorage', async () => {
    class MockRedis {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zremCalled = false;
      public async get(key: string) { return this.store.get(key) || null; }
      public async set(key: string, value: string) { this.store.set(key, value); }
      public async del(key: string) { this.store.delete(key); }
      public async sadd(key: string, member: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(member);
      }
      public async zrem(key: string, member: string) {
        this.zremCalled = true;
      }
    }
    const mockRedis = new MockRedis();
    const storage = new RedisJobStorage(mockRedis);
    const jobItem: any = {
      id: 'job-non-pending',
      queue: 'test-queue',
      name: 'test',
      payload: {},
      status: 'running',
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };
    await storage.save(jobItem);
    expect(mockRedis.zremCalled).toBe(true);
  });

  it('should acquire jobs with same priority in order of runAt', async () => {
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
      public async zadd(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
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
      public async zrem(key: string, member: string) {}
    }

    const mockRedis = new MockRedis();
    const storage = new RedisJobStorage(mockRedis);
    const now = Date.now();

    const job1 = {
      id: 'job-earlier',
      queue: 'same-priority',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 10,
      runAt: now - 100,
      attempts: 0,
      maxAttempts: 3,
    };
    const job2 = {
      id: 'job-later',
      queue: 'same-priority',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 10,
      runAt: now - 50,
      attempts: 0,
      maxAttempts: 3,
    };

    await storage.save(job1);
    await storage.save(job2);

    const acquired = await storage.acquireNext('same-priority', 5000);
    expect(acquired).not.toBeNull();
    expect(acquired!.id).toBe('job-earlier');
  });

  it('should return null if eval/Lua script fails to acquire lock', async () => {
    class MockRedisWithFailedEval {
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
      public async zadd(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
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
      public async eval() {
        return null;
      }
    }
    const mockRedis = new MockRedisWithFailedEval();
    const storage = new RedisJobStorage(mockRedis);
    const jobItem = {
      id: 'job-failed-lua',
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

    const acquired = await storage.acquireNext('test-queue', 5000);
    expect(acquired).toBeNull();
  });

  it('should return null in RedisJobStorage fallback path if status is not pending', async () => {
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
      public async zadd(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
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
      public async zrem(key: string, member: string) {
        if (this.zsets.has(key)) this.zsets.get(key)!.delete(member);
      }
    }

    const mockRedis = new MockRedis();
    const storage = new RedisJobStorage(mockRedis);
    const now = Date.now();

    const job = {
      id: 'job-not-pending-fallback',
      queue: 'fallback-queue',
      name: 'n',
      payload: {},
      status: 'running' as const,
      priority: 10,
      runAt: now - 100,
      attempts: 0,
      maxAttempts: 3,
    };
    await storage.save(job);

    const acquired = await storage.acquireNext('fallback-queue', 5000);
    expect(acquired).toBeNull();
  });
});

