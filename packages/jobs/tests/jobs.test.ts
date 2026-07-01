import { describe, it, expect, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { MemoryJobStorage } from '../src/storage';
import {
  JobScheduler,
  SagaCoordinator,
  jobsModule,
  RedisJobStorage,
  SQLJobStorage,
  setTracingEnabledForTesting,
} from '../src/index';

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
      },
    );

    saga.addStep(
      'step2',
      async (ctx) => {
        stepsRun.push('step2');
        throw new Error('step2 crash');
      },
      async (ctx) => {
        compensationsRun.push('step2-comp');
      },
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

      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }

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

      // eval is required for atomic job locking
      public async eval(
        script:
          | string
          | { script: string; keys: string[]; arguments: string[] },
        numkeys?: number,
        ...args: string[]
      ) {
        let lockKey = '';
        if (typeof script === 'object' && script !== null) {
          lockKey = script.keys[0] || '';
        } else {
          lockKey = args[0] || '';
        }
        const rawJob = this.store.get(lockKey);
        if (rawJob) {
          const job = JSON.parse(rawJob);
          if (job.status !== 'pending') return null;
          job.status = 'running';
          job.lockedAt = Date.now() + 5000;
          this.store.set(lockKey, JSON.stringify(job));
          return JSON.stringify(job);
        }
        return null;
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

    await api.context.with(
      api.trace.setSpan(api.context.active(), parentSpan),
      async () => {
        await scheduler.enqueue('trace-test', {});
      },
    );

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

    vi.spyOn(scheduler, 'enqueue').mockRejectedValue(
      new Error('Enqueue failed'),
    );

    const saga = new SagaCoordinator(scheduler);
    saga.addStep(
      'step1',
      async () => ({ ok: true }),
      async () => {},
    );
    saga.addStep(
      'step2',
      async () => {
        throw new Error('Crash');
      },
      async () => {},
    );

    await saga.execute({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[Axiomify Saga] Compensation failed for step "step1":',
      ),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('should use Lua lock script when eval function is present on Redis client', async () => {
    class MockRedisWithEval {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zsets = new Map<string, Map<string, number>>();
      public keysCalled = false;

      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }
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

      public async keys(pattern: string) {
        this.keysCalled = true;
        return Array.from(this.store.keys());
      }

      public async eval(
        script:
          | string
          | { script: string; keys: string[]; arguments: string[] },
        numkeys?: number,
        ...args: string[]
      ) {
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
    // KEYS is no longer used (replaced with SCAN for safety), verify clear works via tracked sets
    expect(mockRedis.store.size).toBe(0);
  });

  it('should use Lua lock script when evalsha is present on Redis client', async () => {
    class MockRedisWithEvalSha {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zsets = new Map<string, Map<string, number>>();
      public keysCalled = false;

      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }
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
    expect(() => new RedisJobStorage(null)).toThrow(
      '[Axiomify Jobs] Redis client is required.',
    );
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
    await expect(storage.getJobs('test-queue')).rejects.toThrow(
      'Unsupported database client interface',
    );
  });

  it('should throw when constructor is missing client', () => {
    expect(() => new SQLJobStorage(null)).toThrow(
      'SQL client database instance is required.',
    );
  });

  it('should perform CRUD operations on SQLJobStorage', async () => {
    const db = new Map<string, any>();
    const mockPg = {
      query: async (sql: string, params: any[] = []) => {
        const sqlUpper = sql.toUpperCase();
        // Atomic UPDATE ... RETURNING for acquireNext (must be checked before other patterns)
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes('RETURNING')
        ) {
          const [lockedAt, queue, now] = params;
          const list = Array.from(db.values())
            .filter(
              (r) =>
                r.queue === queue &&
                r.status === 'pending' &&
                Number(r.runAt) <= Number(now),
            )
            .sort((a, b) => b.priority - a.priority);
          const target = list[0];
          if (target) {
            target.status = 'running';
            target.lockedAt = lockedAt;
            return [target];
          }
          return [];
        }
        if (
          sqlUpper.includes('SELECT ID FROM AXIOMIFY_JOBS') &&
          sqlUpper.includes('WHERE ID =')
        ) {
          const id = params[0];
          const row = db.get(id);
          return row ? [row] : [];
        }
        if (sqlUpper.includes('INSERT INTO AXIOMIFY_JOBS')) {
          const [
            id,
            queue,
            name,
            payload,
            status,
            priority,
            runAt,
            attempts,
            maxAttempts,
            error,
            lockedAt,
            traceContext,
          ] = params;
          const row = {
            id,
            queue,
            name,
            payload,
            status,
            priority,
            runAt,
            attempts,
            maxAttempts,
            error,
            lockedAt,
            traceContext,
          };
          db.set(id, row);
          return [];
        }
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes('SET STATUS =') &&
          sqlUpper.includes('PRIORITY =')
        ) {
          const [
            status,
            priority,
            runAt,
            attempts,
            maxAttempts,
            error,
            lockedAt,
            queue,
            id,
          ] = params;
          const existing = db.get(id);
          if (existing) {
            Object.assign(existing, {
              status,
              priority,
              runAt: Number(runAt),
              attempts,
              maxAttempts,
              error,
              lockedAt,
              queue,
            });
          }
          return [];
        }
        if (
          sqlUpper.includes('SELECT * FROM AXIOMIFY_JOBS') &&
          sqlUpper.includes('QUEUE =')
        ) {
          const queue = params[0];
          const list = Array.from(db.values()).filter((r) => r.queue === queue);
          return list;
        }
        // Note: The old separate UPDATE SET STATUS='running' is no longer used;
        // acquireNext now uses atomic UPDATE...RETURNING above.
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes("SET STATUS = 'COMPLETED'")
        ) {
          const [id] = params;
          const existing = db.get(id);
          if (existing) {
            existing.status = 'completed';
            existing.lockedAt = null;
          }
          return [];
        }
        if (
          sqlUpper.includes('SELECT ATTEMPTS') &&
          sqlUpper.includes('MAXATTEMPTS') &&
          sqlUpper.includes('WHERE ID =')
        ) {
          const id = params[0];
          const row = db.get(id);
          return row
            ? [{ attempts: row.attempts, maxAttempts: row.maxAttempts }]
            : [];
        }
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes("SET STATUS = 'PENDING'") &&
          sqlUpper.includes('ATTEMPTS =')
        ) {
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
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes("SET STATUS = 'FAILED'") &&
          sqlUpper.includes('ATTEMPTS =')
        ) {
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
      },
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
      traceContext: { parentSpanId: '123' },
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
    let savedTraceContext: any = null;
    const mockPg = {
      query: async (sql: string, params: any[] = []) => {
        const sqlUpper = sql.toUpperCase();
        // Atomic UPDATE...RETURNING for acquireNext (must check first)
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes('RETURNING')
        ) {
          return [
            {
              id: 'sql-job-2',
              queue: 'sql-queue',
              name: 'task-2',
              payload: savedPayload,
              status: 'running',
              priority: 10,
              runAt: Date.now() - 100,
              attempts: 0,
              maxAttempts: 2,
              traceContext: savedTraceContext,
            },
          ];
        }
        if (
          sqlUpper.includes('SELECT ID FROM AXIOMIFY_JOBS') &&
          sqlUpper.includes('WHERE ID =')
        ) {
          return [];
        }
        if (sqlUpper.includes('INSERT INTO AXIOMIFY_JOBS')) {
          savedPayload = params[3];
          savedTraceContext = params[11] || null;
          return [];
        }
        return [];
      },
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
      traceContext: { parentSpanId: '456' },
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
    // Poll for the terminal state instead of a fixed sleep: a fixed window is
    // flaky under load (retries can slip past the deadline, leaving 'pending').
    const deadline = Date.now() + 3000;
    let jobs = await storage.getJobs();
    while (jobs[0]?.status !== 'failed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      jobs = await storage.getJobs();
    }
    await scheduler.stop();
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

  it('should support proper cron expression parsing', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-queue-nan',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
    });

    // Use a cron expression that matches every minute (always fires)
    scheduler.schedule('* * * * *', 'cron-task-nan', { foo: 'bar' });

    const now = Date.now();
    // Set lastRun to well before the current minute so it fires
    (scheduler as any).cronTasks[0].lastRun = now - 120000;

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

    vi.spyOn(storage, 'acquireNext').mockRejectedValue(
      new Error('DB connection lost'),
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await scheduler.stop();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Axiomify Jobs] Error acquiring job:'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('should execute Sagas successfully and return success status', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage);
    const saga = new SagaCoordinator(scheduler);

    saga.addStep(
      'step1',
      async (ctx) => 'result1',
      async () => {},
    );
    const result = await saga.execute({ input: 1 });

    expect(result.success).toBe(true);
    expect(result.context.step1).toBe('result1');
  });

  it('should remove job from pending zset when saving non-pending job in RedisJobStorage', async () => {
    class MockRedis {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zremCalled = false;
      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }
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

      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }
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
      // eval is required for atomic job locking
      public async eval(
        script:
          | string
          | { script: string; keys: string[]; arguments: string[] },
        numkeys?: number,
        ...args: string[]
      ) {
        let lockKey = '';
        if (typeof script === 'object' && script !== null) {
          lockKey = script.keys[0] || '';
        } else {
          lockKey = args[0] || '';
        }
        const rawJob = this.store.get(lockKey);
        if (rawJob) {
          const job = JSON.parse(rawJob);
          if (job.status !== 'pending') return null;
          job.status = 'running';
          job.lockedAt = Date.now() + 5000;
          this.store.set(lockKey, JSON.stringify(job));
          // Also remove from pending zset
          const queueKey = `axiomify:queue:${job.queue}:pending_zset`;
          this.zsets.get(queueKey)?.delete(job.id);
          return JSON.stringify(job);
        }
        return null;
      }
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
      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }
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

  it('should throw when Redis client does not support eval for acquireNext', async () => {
    class MockRedisNoEval {
      public store = new Map<string, string>();
      public sets = new Map<string, Set<string>>();
      public zsets = new Map<string, Map<string, number>>();
      public async get(key: string) {
        return this.store.get(key) || null;
      }
      public async set(key: string, value: string) {
        this.store.set(key, value);
      }
      public async del(key: string) {
        this.store.delete(key);
      }
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

    const mockRedis = new MockRedisNoEval();
    const storage = new RedisJobStorage(mockRedis);
    const now = Date.now();

    const job = {
      id: 'job-no-eval',
      queue: 'no-eval-queue',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 10,
      runAt: now - 100,
      attempts: 0,
      maxAttempts: 3,
    };
    await storage.save(job);

    await expect(storage.acquireNext('no-eval-queue', 5000)).rejects.toThrow(
      'Redis client must support EVAL for atomic job locking',
    );
  });

  it('should validate enqueue inputs in scheduler', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage);
    await expect(scheduler.enqueue('', {})).rejects.toThrow(
      'Job name must be a non-empty string',
    );
    await expect(scheduler.enqueue(null as any, {})).rejects.toThrow(
      'Job name must be a non-empty string',
    );
  });

  it('should validate scheduler constructor inputs', () => {
    const storage = new MemoryJobStorage();
    expect(() => new JobScheduler(storage, { maxConcurrency: 0 })).toThrow(
      'maxConcurrency must be greater than 0',
    );
    expect(() => new JobScheduler(storage, { pollIntervalMs: -10 })).toThrow(
      'pollIntervalMs must be greater than 0',
    );
  });

  it('should log warning on drain timeout when stopping scheduler', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'drain-timeout-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      drainTimeoutMs: 10,
    });
    scheduler.register('slow-drain-job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    await scheduler.enqueue('slow-drain-job', {});
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    scheduler.start();
    const startDeadline = Date.now() + 2000;
    while (scheduler['activeWorkers'].size === 0 && Date.now() < startDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await scheduler.stop();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Force-stopping'),
    );
    consoleSpy.mockRestore();
  });

  it('should log error when checkCronSchedules throws an error', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-err-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (scheduler as any).checkCronSchedules = vi
      .fn()
      .mockRejectedValue(new Error('Cron config corruption'));

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await scheduler.stop();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Axiomify Jobs] Cron schedule error:'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('should handle job execution timeout by failing the job', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'timeout-job-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      jobTimeoutMs: 20,
    });
    scheduler.register('hanging-job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    await scheduler.enqueue('hanging-job', {}, { attempts: 1 });
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    const jobs = await storage.getJobs();
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toContain('exceeded timeout of 20ms');
  });

  it('should execute Saga compensation jobs on failure', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'saga-comp-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
    });
    const saga = new SagaCoordinator(scheduler);

    let step1Compensated = false;
    saga.addStep(
      'step1',
      async () => 'res1',
      async (ctx) => {
        step1Compensated = true;
      },
    );
    saga.addStep(
      'step2',
      async () => {
        throw new Error('step2 failed');
      },
      async () => {},
    );

    const result = await saga.execute({ input: 123 });
    expect(result.success).toBe(false);

    // Run scheduler to execute the compensation job
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    expect(step1Compensated).toBe(true);
  });

  it('should support advanced cron patterns and steps, ranges, list combinations', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-patterns-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
    });

    // Determine DOW dynamically from a local test Date to be timezone-independent
    const testDate1 = new Date();
    testDate1.setHours(12);
    testDate1.setMinutes(10);
    testDate1.setDate(10);
    testDate1.setMonth(5); // June is 5 (0-indexed)
    const dow1 = testDate1.getDay();

    // Patterns to register
    scheduler.schedule(`*/5 12 10 6 ${dow1}`, 'cron-complex-1', { a: 1 });
    scheduler.schedule('15-30 * * * *', 'cron-complex-2', { b: 2 });
    scheduler.schedule('invalid-cron-pattern', 'cron-complex-3', { c: 3 });

    // Mock Date.now to return testDate1 time for Case 1
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockReturnValue(testDate1.getTime());
    await (scheduler as any).checkCronSchedules();

    // Case 2: Match complex-2 (Minute=20)
    const testDate2 = new Date();
    testDate2.setMinutes(20);
    dateSpy.mockReturnValue(testDate2.getTime());
    await (scheduler as any).checkCronSchedules();

    dateSpy.mockRestore();

    const jobs = await storage.getJobs();
    expect(jobs.some((j) => j.name === 'cron-complex-1')).toBe(true);
    expect(jobs.some((j) => j.name === 'cron-complex-2')).toBe(true);
    expect(jobs.some((j) => j.name === 'cron-complex-3')).toBe(false);
  });

  it('should support different Redis client styles for clear and acquireNext', async () => {
    // 1. node-redis v4 style with scanIterator for clear
    const mockClientV4 = {
      scanIterator: () => {},
      smembers: async () => ['job-1'],
      del: async () => {},
    };
    const storageV4 = new RedisJobStorage(mockClientV4);
    await storageV4.clear();

    // 2. Client with scan returning object format (node-redis v4 style scan)
    let scanCalls = 0;
    const mockClientObjectScan = {
      smembers: async () => [],
      scan: async () => {
        scanCalls++;
        if (scanCalls === 1) {
          return { cursor: '10', keys: ['axiomify:queue:x'] };
        }
        return { cursor: '0', keys: ['axiomify:queue:y'] };
      },
      del: async () => {},
    };
    const storageObjectScan = new RedisJobStorage(mockClientObjectScan);
    await storageObjectScan.clear();
    expect(scanCalls).toBe(2);

    // 3. Client where scan throws error
    const mockClientThrowScan = {
      smembers: async () => [],
      scan: async () => {
        throw new Error('Redis scan error');
      },
      del: async () => {},
    };
    const storageThrowScan = new RedisJobStorage(mockClientThrowScan);
    await storageThrowScan.clear();

    // 4. Redis acquireNext candidate sorting (by priority)
    const mockRedisSorted = {
      zrangebyscore: async () => ['job-high', 'job-low'],
      mget: async () => [
        JSON.stringify({
          id: 'job-high',
          queue: 'q',
          name: 'n',
          runAt: Date.now() - 50,
          priority: 100,
          attempts: 0,
          maxAttempts: 3,
          status: 'pending',
        }),
        JSON.stringify({
          id: 'job-low',
          queue: 'q',
          name: 'n',
          runAt: Date.now() - 50,
          priority: 5,
          attempts: 0,
          maxAttempts: 3,
          status: 'pending',
        }),
      ],
      // node-redis style EVAL (EVALSHA does not exist)
      eval: async (opts: any) => {
        return JSON.stringify({
          id: opts.keys[0].split(':').pop(),
          status: 'running',
        });
      },
      zrem: async () => {},
    };
    const storageSorted = new RedisJobStorage(mockRedisSorted);
    const acquired = await storageSorted.acquireNext('q', 5000);
    expect(acquired?.id).toBe('job-high');
  });

  it('should warn when overwriting a registered job handler', () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    scheduler.register('job-dup', () => {});
    scheduler.register('job-dup', () => {});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[Axiomify Jobs] Handler "job-dup" is being overwritten.',
      ),
    );
    consoleSpy.mockRestore();
  });

  it('should purge completed and failed jobs in MemoryJobStorage', async () => {
    const storage = new MemoryJobStorage();
    const now = Date.now();

    const job1 = {
      id: 'job-1',
      queue: 'default',
      name: 'n',
      payload: {},
      status: 'completed' as const,
      priority: 10,
      runAt: now - 5000,
      attempts: 1,
      maxAttempts: 3,
    };
    const job2 = {
      id: 'job-2',
      queue: 'default',
      name: 'n',
      payload: {},
      status: 'failed' as const,
      priority: 10,
      runAt: now - 1000,
      attempts: 3,
      maxAttempts: 3,
    };
    const job3 = {
      id: 'job-3',
      queue: 'default',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 10,
      runAt: now,
      attempts: 0,
      maxAttempts: 3,
    };

    await storage.save(job1);
    await storage.save(job2);
    await storage.save(job3);

    // Purge older than 2000ms (job1 completed 5000ms ago, job2 failed 1000ms ago)
    const removed1 = await storage.purge(2000);
    expect(removed1).toBe(1); // only job1 removed

    const jobs = await storage.getJobs();
    expect(jobs.some((j) => j.id === 'job-1')).toBe(false);
    expect(jobs.some((j) => j.id === 'job-2')).toBe(true);
    expect(jobs.some((j) => j.id === 'job-3')).toBe(true);

    // Purge all remaining completed/failed
    const removed2 = await storage.purge();
    expect(removed2).toBe(1); // job2 removed

    const remainingJobs = await storage.getJobs();
    expect(remainingJobs.some((j) => j.id === 'job-2')).toBe(false);
    expect(remainingJobs.some((j) => j.id === 'job-3')).toBe(true);
  });

  it('should support ioredis array scan format and other scan return types', async () => {
    // 1. Array scanning style
    let scanCallsArray = 0;
    const mockClientArrayScan = {
      smembers: async () => [],
      scan: async () => {
        scanCallsArray++;
        if (scanCallsArray === 1) {
          return ['10', ['axiomify:queue:x']];
        }
        return ['0', []];
      },
      del: async () => {},
    };
    const storageArrayScan = new RedisJobStorage(mockClientArrayScan);
    await storageArrayScan.clear();
    expect(scanCallsArray).toBe(2);

    // 2. Scan returning unexpected string format
    const mockClientStringScan = {
      smembers: async () => [],
      scan: async () => {
        return 'unexpected-string';
      },
      del: async () => {},
    };
    const storageStringScan = new RedisJobStorage(mockClientStringScan);
    await storageStringScan.clear();

    // 3. ScanIterator + scan combined (to hit scanIterator check on line 438)
    const mockClientCombined = {
      scan: () => {},
      scanIterator: () => {},
      smembers: async () => [],
      del: async () => {},
    };
    const storageCombined = new RedisJobStorage(mockClientCombined);
    await storageCombined.clear();
  });

  it('should fallback to SREM, DEL, SADD, ZADD camelCase/UPPERCASE methods on Redis client', async () => {
    const mockClientUpper = {
      GET: vi.fn().mockResolvedValue(null),
      SET: vi.fn().mockResolvedValue('OK'),
      DEL: vi.fn().mockResolvedValue(1),
      SADD: vi.fn().mockResolvedValue(1),
      SREM: vi.fn().mockResolvedValue(1),
      SMEMBERS: vi.fn().mockResolvedValue([]),
      ZADD: vi.fn().mockResolvedValue(1),
      ZREM: vi.fn().mockResolvedValue(1),
      get: undefined,
      set: undefined,
      zadd: undefined,
      sadd: undefined,
      srem: undefined,
      smembers: undefined,
      del: undefined,
      zrem: undefined,
    };
    const storageUpper = new RedisJobStorage(mockClientUpper);
    const job = {
      id: 'job-upper',
      queue: 'upper-queue',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 10,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };
    await storageUpper.save(job);
    expect(mockClientUpper.ZADD).toHaveBeenCalled();
    expect(mockClientUpper.SADD).toHaveBeenCalled();

    // Trigger complete to hit ZREM/DEL/SREM UPPERCASE fallbacks
    // We mock GET to return the job first so complete() has job data
    mockClientUpper.GET.mockResolvedValue(JSON.stringify(job));
    await storageUpper.complete('job-upper');
    expect(mockClientUpper.ZREM).toHaveBeenCalled();

    // Call private srem and del directly to cover UPPERCASE fallbacks
    await (storageUpper as any).srem('axiomify:jobs:all', 'job-upper');
    await (storageUpper as any).del('axiomify:job:job-upper');
    expect(mockClientUpper.SREM).toHaveBeenCalled();
    expect(mockClientUpper.DEL).toHaveBeenCalled();
  });

  it('should continue to next candidate if Lua eval throws an error for one candidate', async () => {
    const mockRedisEvalThrow = {
      zrangebyscore: async () => ['job-fail', 'job-success'],
      mget: async () => [
        JSON.stringify({
          id: 'job-fail',
          queue: 'q',
          name: 'n',
          runAt: Date.now() - 50,
          priority: 10,
          attempts: 0,
          maxAttempts: 3,
          status: 'pending',
        }),
        JSON.stringify({
          id: 'job-success',
          queue: 'q',
          name: 'n',
          runAt: Date.now() - 50,
          priority: 10,
          attempts: 0,
          maxAttempts: 3,
          status: 'pending',
        }),
      ],
      eval: async (script: any, numkeys?: number, ...args: string[]) => {
        let lockKey = '';
        if (typeof script === 'object' && script !== null) {
          lockKey = script.keys[0] || '';
        } else {
          lockKey = args[0] || '';
        }
        if (lockKey.includes('job-fail')) {
          throw new Error('Redis eval failed for job-fail');
        }
        return JSON.stringify({ id: 'job-success', status: 'running' });
      },
      zrem: async () => {},
    };
    const storageEvalThrow = new RedisJobStorage(mockRedisEvalThrow);
    const acquiredThrow = await storageEvalThrow.acquireNext('q', 5000);
    expect(acquiredThrow?.id).toBe('job-success');
  });

  it('should fail OTel require gracefully when @opentelemetry/api throws an error during resolve', async () => {
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (...args: any[]) {
      if (args[0] === '@opentelemetry/api') {
        throw new Error('OTel module missing');
      }
      return originalRequire.apply(this, args);
    };

    try {
      const storage = new MemoryJobStorage();
      const scheduler = new JobScheduler(storage, {
        queue: 'otel-fail-queue',
        pollIntervalMs: 5,
      });
      scheduler.register('otel-job', () => {});
      await scheduler.enqueue('otel-job', {});
      scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 15));
      await scheduler.stop();
    } finally {
      Module.prototype.require = originalRequire;
    }
  });

  it('should handle NaN and invalid range/step inputs in matchesCronField', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-nan-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
    });

    // Patterns with different invalid NaN combinations
    scheduler.schedule('abc/5 * * * *', 'cron-nan-complex', { a: 1 });
    scheduler.schedule('*/abc * * * *', 'cron-nan-complex', { b: 2 });
    scheduler.schedule('*/-5 * * * *', 'cron-nan-complex', { c: 3 });
    scheduler.schedule('10-abc * * * *', 'cron-nan-complex', { d: 4 });
    scheduler.schedule('abc-20 * * * *', 'cron-nan-complex', { e: 5 });
    scheduler.schedule('abc * * * *', 'cron-nan-complex', { f: 6 });
    scheduler.schedule('10/5 12 * * *', 'cron-step-range', { g: 7 });

    const dateSpy = vi.spyOn(Date, 'now');

    // Case 1: Minutes=10, Hours=12
    const testDate1 = new Date();
    testDate1.setMinutes(10);
    testDate1.setHours(12);
    dateSpy.mockReturnValue(testDate1.getTime());
    await (scheduler as any).checkCronSchedules();

    // Case 2: Minutes=12 (should not match 10/5 range step)
    const testDate2 = new Date();
    testDate2.setMinutes(12);
    testDate2.setHours(12);
    dateSpy.mockReturnValue(testDate2.getTime());
    await (scheduler as any).checkCronSchedules();

    dateSpy.mockRestore();

    const jobs = await storage.getJobs();
    expect(jobs.some((j) => j.payload.g === 7)).toBe(true);
    expect(
      jobs.some((j) => j.payload.g === 7 && j.runAt === testDate2.getTime()),
    ).toBe(false);
  });

  it('should support generic typed payloads for autocomplete and verification', async () => {
    interface EmailPayload {
      to: string;
      subject: string;
    }

    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage);

    // Verify it compiles and enforces type
    const handler = vi.fn();
    scheduler.register<EmailPayload>('send-email', (payload) => {
      handler(payload.to, payload.subject);
    });

    await scheduler.enqueue<EmailPayload>('send-email', {
      to: 'user@example.com',
      subject: 'Hello World',
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    expect(handler).toHaveBeenCalledWith('user@example.com', 'Hello World');
  });

  it('should route jobs to DLQ and emit dlq event on exhaustion', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'dlq-test-queue',
      dlqQueue: 'dlq-test-queue:dlq',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
    });

    let failedEmitted = false;
    let dlqEmitted = false;

    scheduler.on('failed', () => {
      failedEmitted = true;
    });

    scheduler.on('dlq', (job, err) => {
      dlqEmitted = true;
      expect(job.queue).toBe('dlq-test-queue:dlq');
      expect(job.status).toBe('failed');
      expect(err.message).toBe('perma-crash');
    });

    scheduler.register('always-crash', () => {
      throw new Error('perma-crash');
    });

    await scheduler.enqueue('always-crash', {}, { attempts: 1 });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    expect(failedEmitted).toBe(true);
    expect(dlqEmitted).toBe(true);

    const jobs = await storage.getJobs('dlq-test-queue:dlq');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toBe('perma-crash');
  });

  it('should emit scheduler event lifecycle milestones: start, completed, failed, retry', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'events-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      defaultRetryDelayMs: 5,
    });

    const events: string[] = [];
    scheduler.on('start', (job) => events.push(`start:${job.name}`));
    scheduler.on('completed', (job) => events.push(`completed:${job.name}`));
    scheduler.on('retry', (job) => events.push(`retry:${job.name}`));
    scheduler.on('failed', (job) => events.push(`failed:${job.name}`));

    scheduler.register('success-job', () => {});
    let attempt = 0;
    scheduler.register('retry-fail-job', () => {
      attempt++;
      throw new Error(`error-run-${attempt}`);
    });

    await scheduler.enqueue('success-job', {});
    await scheduler.enqueue('retry-fail-job', {}, { attempts: 2 });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await scheduler.stop();

    expect(events).toContain('start:success-job');
    expect(events).toContain('completed:success-job');
    expect(events).toContain('start:retry-fail-job');
    expect(events).toContain('retry:retry-fail-job');
    expect(events).toContain('failed:retry-fail-job');
  });

  it('should invoke acquireCronLock and respect locks for distributed cron scheduler', async () => {
    const storage = new MemoryJobStorage();

    const scheduler = new JobScheduler(storage, {
      queue: 'dist-cron-queue',
      pollIntervalMs: 5,
    });

    // Provide mock acquireCronLock method directly
    let lockAcquired = false;
    (storage as any).acquireCronLock = async (key: string, ttlMs: number) => {
      lockAcquired = true;
      return false; // prevent execution
    };

    scheduler.schedule('1', 'cron-lock-test', {});
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    expect(lockAcquired).toBe(true);
    const jobs = await storage.getJobs();
    // No job should be enqueued because lock returned false
    expect(jobs.filter((j) => j.name === 'cron-lock-test')).toHaveLength(0);
  });

  it('should map lockedAt to lockExpiresAt and support backward compatibility', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'compat-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 10000,
    });

    scheduler.register('compat-job', () => {});
    await scheduler.enqueue('compat-job', {});

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await scheduler.stop();

    const jobs = await storage.getJobs();
    expect(jobs[0].lockExpiresAt).toBeDefined();
    expect(jobs[0].lockedAt).toBe(jobs[0].lockExpiresAt);
  });

  it('should test all paths of acquireCronLock in RedisJobStorage', async () => {
    // 1. Success via standard positional arguments (SET key 1 NX PX ttlMs)
    const mockClient1 = {
      set: vi.fn().mockResolvedValue('OK'),
    };
    const storage1 = new RedisJobStorage(mockClient1 as any);
    const res1 = await storage1.acquireCronLock('key1', 5000);
    expect(res1).toBe(true);
    expect(mockClient1.set).toHaveBeenCalledWith('key1', '1', 'NX', 'PX', 5000);

    // 2. Success via object arguments fallback
    const mockClient2 = {
      set: vi.fn().mockImplementation((key, val, nx, px, ttl) => {
        if (typeof nx === 'string') throw new Error('not supported');
        return 'OK';
      }),
    };
    const storage2 = new RedisJobStorage(mockClient2 as any);
    const res2 = await storage2.acquireCronLock('key2', 5000);
    expect(res2).toBe(true);
    expect(mockClient2.set).toHaveBeenLastCalledWith('key2', '1', {
      NX: true,
      PX: 5000,
    });

    // 3. Complete failure (throws on both)
    const mockClient3 = {
      set: vi.fn().mockRejectedValue(new Error('fail')),
    };
    const storage3 = new RedisJobStorage(mockClient3 as any);
    const res3 = await storage3.acquireCronLock('key3', 5000);
    expect(res3).toBe(false);

    // 4. Client with uppercase SET
    const mockClient4 = {
      SET: vi.fn().mockResolvedValue('OK'),
    };
    const storage4 = new RedisJobStorage(mockClient4 as any);
    const res4 = await storage4.acquireCronLock('key4', 5000);
    expect(res4).toBe(true);
    expect(mockClient4.SET).toHaveBeenCalledWith('key4', '1', 'NX', 'PX', 5000);
  });

  it('should cover MemoryJobStorage.fail when attempts >= maxAttempts', async () => {
    const storage = new MemoryJobStorage();
    const job = {
      id: 'job-mem-fail',
      queue: 'default',
      name: 'test',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 1,
    };
    await storage.save(job);
    await storage.fail('job-mem-fail', 'some-error');
    const jobs = await storage.getJobs();
    expect(jobs[0].status).toBe('failed');

    await storage.clear();
    const jobsAfterClear = await storage.getJobs();
    expect(jobsAfterClear).toHaveLength(0);
  });

  it('should parse cron expression with comma-separated list patterns', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'cron-list-queue',
      pollIntervalMs: 5,
    });
    // Register cron pattern using list (e.g. *,* * * * *)
    scheduler.schedule('*,* * * * *', 'list-task', {});
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await scheduler.stop();
    const jobs = await storage.getJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);
  });

  it('should fail a job permanently without DLQ if dlqQueue is disabled/empty', async () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage, {
      queue: 'no-dlq-queue',
      maxConcurrency: 1,
      pollIntervalMs: 5,
      lockDurationMs: 1000,
      defaultRetryDelayMs: 10,
      dlqQueue: '', // Empty string disables DLQ evaluation
    });

    let runs = 0;
    scheduler.register('fail-forever', () => {
      runs += 1;
      throw new Error('permanent-failure');
    });

    await scheduler.enqueue('fail-forever', {}, { attempts: 1 });
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await scheduler.stop();

    expect(runs).toBe(1);
    const jobs = await storage.getJobs();
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].queue).toBe('no-dlq-queue'); // should not be moved to DLQ queue
  });

  it('should cover acquireLocalCronLock false branch when lock is active', () => {
    const storage = new MemoryJobStorage();
    const scheduler = new JobScheduler(storage);
    const res1 = (scheduler as any).acquireLocalCronLock('test-lock', 5000);
    expect(res1).toBe(true);
    const res2 = (scheduler as any).acquireLocalCronLock('test-lock', 5000);
    expect(res2).toBe(false);
  });

  it('should cover legacy payload-embedded traceContext in SQLJobStorage', async () => {
    // 1. Path with __value wrapper inside acquireNext (mapRow)
    const mockPg1 = {
      query: async (sql: string, params: any[]) => {
        const sqlUpper = sql.toUpperCase();
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes('RETURNING')
        ) {
          return [
            {
              id: 'sql-legacy-1',
              queue: 'q',
              name: 'n',
              payload: JSON.stringify({
                _traceContext: { traceparent: 'legacy-trace-1' },
                __value: 'primitive-val',
              }),
              status: 'running',
              priority: 0,
              runAt: Date.now(),
              attempts: 0,
              maxAttempts: 3,
              traceContext: null,
            },
          ];
        }
        return [];
      },
    };
    const storage1 = new SQLJobStorage(mockPg1);
    const acquired1 = await storage1.acquireNext('q', 5000);
    expect(acquired1!.payload).toBe('primitive-val');
    expect(acquired1!.traceContext).toEqual({ traceparent: 'legacy-trace-1' });

    // 2. Path without __value wrapper inside acquireNext (mapRow)
    const mockPg2 = {
      query: async (sql: string, params: any[]) => {
        const sqlUpper = sql.toUpperCase();
        if (
          sqlUpper.includes('UPDATE AXIOMIFY_JOBS') &&
          sqlUpper.includes('RETURNING')
        ) {
          return [
            {
              id: 'sql-legacy-2',
              queue: 'q',
              name: 'n',
              payload: JSON.stringify({
                _traceContext: { traceparent: 'legacy-trace-2' },
                foo: 'bar',
              }),
              status: 'running',
              priority: 0,
              runAt: Date.now(),
              attempts: 0,
              maxAttempts: 3,
              traceContext: null,
            },
          ];
        }
        return [];
      },
    };
    const storage2 = new SQLJobStorage(mockPg2);
    const acquired2 = await storage2.acquireNext('q', 5000);
    expect(acquired2!.payload).toEqual({ foo: 'bar' });
    expect(acquired2!.traceContext).toEqual({ traceparent: 'legacy-trace-2' });

    // 3. Path with __value wrapper inside getJobs
    const mockPg3 = {
      query: async (sql: string, params: any[]) => {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT * FROM AXIOMIFY_JOBS')) {
          return [
            {
              id: 'sql-legacy-3',
              queue: 'q',
              name: 'n',
              payload: {
                _traceContext: { traceparent: 'legacy-trace-3' },
                __value: 'primitive-val-3',
              },
              status: 'pending',
              priority: 0,
              runAt: Date.now(),
              attempts: 0,
              maxAttempts: 3,
              traceContext: null,
            },
          ];
        }
        return [];
      },
    };
    const storage3 = new SQLJobStorage(mockPg3);
    const jobs3 = await storage3.getJobs('q');
    expect(jobs3[0].payload).toBe('primitive-val-3');
    expect(jobs3[0].traceContext).toEqual({ traceparent: 'legacy-trace-3' });

    // 4. Path without __value wrapper inside getJobs
    const mockPg4 = {
      query: async (sql: string, params: any[]) => {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT * FROM AXIOMIFY_JOBS')) {
          return [
            {
              id: 'sql-legacy-4',
              queue: 'q',
              name: 'n',
              payload: {
                _traceContext: { traceparent: 'legacy-trace-4' },
                data: 'object-val',
              },
              status: 'pending',
              priority: 0,
              runAt: Date.now(),
              attempts: 0,
              maxAttempts: 3,
              traceContext: null,
            },
          ];
        }
        return [];
      },
    };
    const storage4 = new SQLJobStorage(mockPg4);
    const jobs4 = await storage4.getJobs('q');
    expect(jobs4[0].payload).toEqual({ data: 'object-val' });
    expect(jobs4[0].traceContext).toEqual({ traceparent: 'legacy-trace-4' });
  });

  it('should cover RedisJobStorage.save when lockExpiresAt is defined', async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      sadd: vi.fn().mockResolvedValue(1),
      zadd: vi.fn().mockResolvedValue(1),
      zrem: vi.fn().mockResolvedValue(1),
    };
    const storage = new RedisJobStorage(mockRedis as any);
    const job = {
      id: 'job-redis-lock-expire',
      queue: 'q',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
      lockExpiresAt: 12345678,
    };
    await storage.save(job);
    expect(job.lockedAt).toBe(12345678);
  });

  it('should reclaim expired running leases in SQLJobStorage.acquireNext', async () => {
    const mockPg = {
      query: async (sql: string, params: any[]) => {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('RETURNING')) {
          expect(sqlUpper).toContain('LOCKEDAT');
          return [{
            id: 'sql-reclaimed-job',
            queue: 'q',
            name: 'n',
            payload: '{}',
            status: 'running',
            priority: 0,
            runAt: Date.now() - 10000,
            attempts: 0,
            maxAttempts: 3,
            lockedAt: Date.now() - 5000
          }];
        }
        return [];
      }
    };
    const storage = new SQLJobStorage(mockPg);
    const acquired = await storage.acquireNext('q', 5000);
    expect(acquired).not.toBeNull();
    expect(acquired!.id).toBe('sql-reclaimed-job');
  });

  it('should update the queue name in SQLJobStorage when moving a job to DLQ', async () => {
    const db = new Map<string, any>();
    const mockPg = {
      query: async (sql: string, params: any[]) => {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT ID FROM AXIOMIFY_JOBS') && sqlUpper.includes('WHERE ID =')) {
          return db.has(params[0]) ? [db.get(params[0])] : [];
        }
        if (sqlUpper.includes('INSERT INTO AXIOMIFY_JOBS')) {
          const [id, queue, name, payload, status, priority, runAt, attempts, maxAttempts, error, lockedAt, traceContext] = params;
          const row = { id, queue, name, payload, status, priority, runAt, attempts, maxAttempts, error, lockedAt, traceContext };
          db.set(id, row);
          return [];
        }
        if (sqlUpper.includes('UPDATE AXIOMIFY_JOBS') && sqlUpper.includes('SET STATUS =') && sqlUpper.includes('QUEUE =')) {
          const [status, priority, runAt, attempts, maxAttempts, error, lockedAt, queue, id] = params;
          const existing = db.get(id);
          if (existing) {
            Object.assign(existing, { status, priority, runAt, attempts, maxAttempts, error, lockedAt, queue });
          }
          return [];
        }
        return [];
      }
    };

    const storage = new SQLJobStorage(mockPg);
    const job = {
      id: 'job-1',
      queue: 'main-queue',
      name: 'test-job',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };

    await storage.save(job);
    expect(db.get('job-1').queue).toBe('main-queue');

    job.queue = 'main-queue:dlq';
    job.status = 'failed';
    await storage.save(job);
    expect(db.get('job-1').queue).toBe('main-queue:dlq');
  });

  it('should clean up old queue sets and zsets in RedisJobStorage when moving a job', async () => {
    const mockRedis = {
      store: new Map<string, string>(),
      sets: new Map<string, Set<string>>(),
      zsets: new Map<string, Map<string, number>>(),
      
      get: async function(key: string) { return this.store.get(key) || null; },
      set: async function(key: string, value: string) { this.store.set(key, value); },
      sadd: async function(key: string, member: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(member);
      },
      srem: async function(key: string, member: string) {
        this.sets.get(key)?.delete(member);
      },
      zadd: async function(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
      },
      zrem: async function(key: string, member: string) {
        this.zsets.get(key)?.delete(member);
      }
    };

    const storage = new RedisJobStorage(mockRedis as any);
    const job = {
      id: 'job-redis-shift',
      queue: 'main-queue',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };

    await storage.save(job);
    expect(mockRedis.sets.get('axiomify:queue:main-queue:jobs')?.has('job-redis-shift')).toBe(true);
    expect(mockRedis.zsets.get('axiomify:queue:main-queue:pending_zset')?.has('job-redis-shift')).toBe(true);

    job.queue = 'main-queue:dlq';
    job.status = 'failed';
    await storage.save(job);

    expect(mockRedis.sets.get('axiomify:queue:main-queue:dlq:jobs')?.has('job-redis-shift')).toBe(true);
    expect(mockRedis.sets.get('axiomify:queue:main-queue:jobs')?.has('job-redis-shift')).toBe(false);
    expect(mockRedis.zsets.get('axiomify:queue:main-queue:pending_zset')?.has('job-redis-shift')).toBe(false);
  });

  it('should handle JSON parse errors gracefully in RedisJobStorage.save', async () => {
    const mockRedis = {
      store: new Map<string, string>(),
      get: async function(key: string) { return this.store.get(key) || null; },
      set: async function(key: string, value: string) { this.store.set(key, value); },
      sadd: async function() {},
      srem: async function() {},
      zadd: async function() {},
      zrem: async function() {},
    };

    const storage = new RedisJobStorage(mockRedis as any);
    const job = {
      id: 'job-invalid-json',
      queue: 'main-queue',
      name: 'n',
      payload: {},
      status: 'pending' as const,
      priority: 0,
      runAt: Date.now(),
      attempts: 0,
      maxAttempts: 3
    };

    // Put invalid JSON in mock store to trigger catch block in save()
    mockRedis.store.set(`axiomify:job:${job.id}`, '{invalid-json');
    
    // Save should run and not throw
    await expect(storage.save(job)).resolves.not.toThrow();
  });

  it('should test remaining RedisJobStorage and SQLJobStorage edge cases for full coverage', async () => {
    // A. SQLJobStorage edge cases
    const mockPg = {
      query: async (sql: string, params?: any[]) => {
        return { rows: [] };
      }
    };
    const sqlStorage = new SQLJobStorage(mockPg as any);
    
    // 1. empty acquire -> returns null (line 247)
    const sqlAcquired = await sqlStorage.acquireNext('sql-empty-queue', 1000);
    expect(sqlAcquired).toBeNull();

    // 2. fail non-existent -> returns early (line 304)
    await expect(sqlStorage.fail('non-existent-id', 'err')).resolves.not.toThrow();

    // B. RedisJobStorage edge cases
    const mockRedis = {
      store: new Map<string, string>(),
      sets: new Map<string, Set<string>>(),
      zsets: new Map<string, Map<string, number>>(),
      get: async function(key: string) { return this.store.get(key) || null; },
      set: async function(key: string, value: string) { this.store.set(key, value); },
      sadd: async function(key: string, val: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(val);
      },
      srem: async function(key: string, val: string) {
        this.sets.get(key)?.delete(val);
      },
      smembers: async function(key: string) {
        return Array.from(this.sets.get(key) || []);
      },
      zadd: async function(key: string, score: number, member: string) {
        if (!this.zsets.has(key)) this.zsets.set(key, new Map());
        this.zsets.get(key)!.set(member, score);
      },
      zrem: async function(key: string, member: string) {
        this.zsets.get(key)?.delete(member);
      },
      zrangebyscore: async function(key: string, min: number, max: number) {
        const map = this.zsets.get(key);
        if (!map) return [];
        return Array.from(map.entries())
          .filter(([_, score]) => score >= min && score <= max)
          .map(([member]) => member);
      },
      mget: async function(keys: string[]) {
        return keys.map((k) => this.store.get(k) || null);
      }
    };

    const redisStorage = new RedisJobStorage(mockRedis as any);

    // 1. mget with empty keys (line 453)
    const mgetRes = await (redisStorage as any).mget([]);
    expect(mgetRes).toEqual([]);

    // 2. acquireNext empty queue (line 560)
    const acquiredEmpty = await redisStorage.acquireNext('empty-redis-queue', 1000);
    expect(acquiredEmpty).toBeNull();

    // 3. acquireNext with non-pending candidate / future candidate (line 579)
    await mockRedis.zadd('axiomify:queue:test-q:pending_zset', Date.now() - 50, 'job-non-pending');
    // Save job as running instead of pending
    const runningJob = {
      id: 'job-non-pending',
      queue: 'test-q',
      name: 'name',
      status: 'running',
      priority: 0,
      runAt: Date.now() - 50,
      attempts: 0,
      maxAttempts: 3
    };
    await mockRedis.set('axiomify:job:job-non-pending', JSON.stringify(runningJob));
    const acquiredNonPending = await redisStorage.acquireNext('test-q', 1000);
    expect(acquiredNonPending).toBeNull();

    // 4. complete on non-existent job (line 652)
    await expect(redisStorage.complete('non-existent-redis-id')).resolves.not.toThrow();

    // 5. fail on non-existent job (line 667)
    await expect(redisStorage.fail('non-existent-redis-id', 'err')).resolves.not.toThrow();

    // 6. getJobs empty queue (line 693)
    const emptyJobs = await redisStorage.getJobs('empty-q');
    expect(emptyJobs).toEqual([]);

    // 7. getJobs sort comparator execution (line 707)
    const jobA = { id: 'a', queue: 'sort-q', name: 'n', status: 'pending', priority: 0, runAt: 100, attempts: 0, maxAttempts: 1 };
    const jobB = { id: 'b', queue: 'sort-q', name: 'n', status: 'pending', priority: 0, runAt: 200, attempts: 0, maxAttempts: 1 };
    await redisStorage.save(jobA as any);
    await redisStorage.save(jobB as any);
    const sortedJobs = await redisStorage.getJobs('sort-q');
    expect(sortedJobs.length).toBe(2);
    // B runAt is 200, A is 100. Sorted descending by runAt, so B should be first
    expect(sortedJobs[0].id).toBe('b');

    // 8. Test getJobs without queue parameter to cover 'axiomify:jobs:all' path
    const allJobs = await redisStorage.getJobs();
    expect(allJobs.length).toBeGreaterThanOrEqual(2);
  });

  it('should cover additional RedisJobStorage client method fallbacks and corrupt JSON acquireNext', async () => {
    // 1. camelCase Client
    const mockCamelClient = {
      store: new Map<string, string>(),
      GET: vi.fn().mockImplementation(async (k) => mockCamelClient.store.get(k) || null),
      SET: vi.fn().mockImplementation(async (k, v) => { mockCamelClient.store.set(k, v); }),
      DEL: vi.fn().mockResolvedValue(1),
      sAdd: vi.fn().mockResolvedValue(1),
      sRem: vi.fn().mockResolvedValue(1),
      sMembers: vi.fn().mockResolvedValue(['job-camel']),
      zAdd: vi.fn().mockResolvedValue(1),
      zRem: vi.fn().mockResolvedValue(1),
      zRangeByScore: vi.fn().mockResolvedValue(['job-camel']),
      mGet: vi.fn().mockResolvedValue([JSON.stringify({
        id: 'job-camel', queue: 'camel-q', name: 'n', status: 'pending', priority: 0, runAt: Date.now(), attempts: 0, maxAttempts: 1
      })]),
      scan: vi.fn().mockResolvedValue(['0']), // undefined result[1] to cover L492 fallback
      eval: vi.fn().mockResolvedValue(JSON.stringify({ id: 'job-camel', status: 'running' }))
    };
    const storageCamel = new RedisJobStorage(mockCamelClient as any);
    await storageCamel.save({
      id: 'job-camel', queue: 'camel-q', name: 'n', status: 'pending', priority: 0, runAt: Date.now(), attempts: 0, maxAttempts: 1, payload: {}
    });
    // Call acquireNext to trigger zRangeByScore
    await storageCamel.acquireNext('camel-q', 1000);
    // Call clear to trigger scan and delete
    await storageCamel.clear();
    const jobsCamel = await storageCamel.getJobs('camel-q');
    expect(jobsCamel).toHaveLength(1);
    expect(mockCamelClient.sMembers).toHaveBeenCalled();

    // 2. UPPERCASE Client
    const mockUpperClient = {
      store: new Map<string, string>(),
      GET: vi.fn().mockImplementation(async (k) => mockUpperClient.store.get(k) || null),
      SET: vi.fn().mockImplementation(async (k, v) => { mockUpperClient.store.set(k, v); }),
      DEL: vi.fn().mockResolvedValue(1),
      SADD: vi.fn().mockResolvedValue(1),
      SREM: vi.fn().mockResolvedValue(1),
      SMEMBERS: vi.fn().mockResolvedValue(['job-upper']),
      ZADD: vi.fn().mockResolvedValue(1),
      ZREM: vi.fn().mockResolvedValue(1),
      ZRANGEBYSCORE: vi.fn().mockResolvedValue(['job-upper']),
      MGET: vi.fn().mockResolvedValue([JSON.stringify({
        id: 'job-upper', queue: 'upper-q', name: 'n', status: 'pending', priority: 0, runAt: Date.now(), attempts: 0, maxAttempts: 1
      })]),
      SCAN: vi.fn().mockResolvedValue({ cursor: '0' }), // undefined keys to cover L496 fallback
      EVAL: vi.fn().mockResolvedValue(JSON.stringify({ id: 'job-upper', status: 'running' }))
    };
    const storageUpper = new RedisJobStorage(mockUpperClient as any);
    await storageUpper.save({
      id: 'job-upper', queue: 'upper-q', name: 'n', status: 'pending', priority: 0, runAt: Date.now(), attempts: 0, maxAttempts: 1, payload: {}
    });
    // Call acquireNext to trigger ZRANGEBYSCORE
    await storageUpper.acquireNext('upper-q', 1000);
    // Call clear to trigger SCAN and delete
    await storageUpper.clear();
    const jobsUpper = await storageUpper.getJobs('upper-q');
    expect(jobsUpper).toHaveLength(1);
    expect(mockUpperClient.SMEMBERS).toHaveBeenCalled();

    // 3. Corrupt/falsy items in RedisJobStorage.acquireNext candidates parsing
    const mockRedisCorrupt = {
      zsets: new Map<string, Map<string, number>>(),
      store: new Map<string, string>(),
      zrangebyscore: async function() {
        return ['job-null', 'job-corrupt', 'job-valid'];
      },
      mget: async function() {
        return [
          null, // covers falsy raw check
          '{invalid-json', // covers JSON parse catch block
          JSON.stringify({
            id: 'job-valid', queue: 'test-q', name: 'n', status: 'pending', priority: 10, runAt: Date.now() - 100, attempts: 0, maxAttempts: 1
          })
        ];
      },
      eval: async function() {
        return JSON.stringify({ id: 'job-valid', status: 'running' });
      }
    };
    const storageCorrupt = new RedisJobStorage(mockRedisCorrupt as any);
    const acquiredCorrupt = await storageCorrupt.acquireNext('test-q', 1000);
    expect(acquiredCorrupt?.id).toBe('job-valid');

    // 4. Test acquireCronLock result permutations (true, 1) in RedisJobStorage
    const mockCronClient = {
      set: vi.fn().mockResolvedValue(true) // returns boolean true
    };
    const storageCron = new RedisJobStorage(mockCronClient as any);
    const resCron1 = await storageCron.acquireCronLock('cron-key-1', 1000);
    expect(resCron1).toBe(true);

    const mockCronClient2 = {
      set: vi.fn().mockResolvedValue(1) // returns number 1
    };
    const storageCron2 = new RedisJobStorage(mockCronClient2 as any);
    const resCron2 = await storageCron2.acquireCronLock('cron-key-2', 1000);
    expect(resCron2).toBe(true);
  });

  it('should handle non-string/falsy payloads and lowercase maxattempts in SQLJobStorage', async () => {
    // 1. Non-string payload & non-string traceContext in acquireNext
    const mockPg1 = {
      query: async () => [{
        id: 'sql-obj-payload',
        queue: 'q',
        name: 'n',
        payload: { foo: 'bar' },
        status: 'running',
        priority: 0,
        runAt: Date.now(),
        attempts: 0,
        maxAttempts: 3,
        traceContext: { traceparent: 'tc-val' }
      }]
    };
    const storage1 = new SQLJobStorage(mockPg1);
    const acquired1 = await storage1.acquireNext('q', 5000);
    expect(acquired1?.payload).toEqual({ foo: 'bar' });
    expect(acquired1?.traceContext).toEqual({ traceparent: 'tc-val' });

    // 2. Falsy payload in acquireNext
    const mockPg2 = {
      query: async () => [{
        id: 'sql-falsy-payload',
        queue: 'q',
        name: 'n',
        payload: null,
        status: 'running',
        priority: 0,
        runAt: Date.now(),
        attempts: 0,
        maxAttempts: 3,
        traceContext: null
      }]
    };
    const storage2 = new SQLJobStorage(mockPg2);
    const acquired2 = await storage2.acquireNext('q', 5000);
    expect(acquired2?.payload).toBeNull();
    expect(acquired2?.traceContext).toBeUndefined();

    // 3. Missing attempts in fail
    const mockPg3 = {
      queries: [] as string[],
      query: async (sql: string) => {
        if (sql.includes('SELECT attempts')) {
          return [{ attempts: null, maxAttempts: 3 }];
        }
        mockPg3.queries.push(sql);
        return [];
      }
    };
    const storage3 = new SQLJobStorage(mockPg3);
    await storage3.fail('job-no-attempts', 'err', 1000);
    expect(mockPg3.queries[0]).toContain("attempts = $1");

    // 4. Lowercase maxattempts in fail
    const mockPg4 = {
      queries: [] as string[],
      query: async (sql: string) => {
        if (sql.includes('SELECT attempts')) {
          return [{ attempts: 0, maxattempts: 5 }];
        }
        mockPg4.queries.push(sql);
        return [];
      }
    };
    const storage4 = new SQLJobStorage(mockPg4);
    await storage4.fail('job-lowercase-maxattempts', 'err', 1000);
    expect(mockPg4.queries[0]).toContain("attempts = $1");

    // 5. Null rows in SQLJobStorage.getJobs
    const mockPg5 = {
      $queryRawUnsafe: async () => null as any
    };
    const storage5 = new SQLJobStorage(mockPg5);
    const jobs5 = await storage5.getJobs();
    expect(jobs5).toEqual([]);

    // 6. Non-string payload & traceContext in getJobs
    const mockPg6 = {
      query: async () => [{
        id: 'sql-jobs-obj',
        queue: 'q',
        name: 'n',
        payload: { x: 1 },
        status: 'pending',
        priority: 0,
        runAt: Date.now(),
        attempts: 0,
        maxAttempts: 3,
        traceContext: { traceparent: 'tc-val-jobs' }
      }, {
        id: 'sql-jobs-falsy',
        queue: 'q',
        name: 'n',
        payload: { x: 1 }, // truthy object, no _traceContext (covers L347 index 1 fallback)
        status: 'pending',
        priority: 0,
        runAt: Date.now(),
        attempts: 0,
        maxAttempts: 3,
        traceContext: null
      }, {
        id: 'sql-jobs-primitive',
        queue: 'q',
        name: 'n',
        payload: '"primitive-payload"',
        status: 'pending',
        priority: 0,
        runAt: Date.now(),
        attempts: 0,
        maxAttempts: 3,
        traceContext: null
      }]
    };
    const storage6 = new SQLJobStorage(mockPg6);
    const jobs6 = await storage6.getJobs('q');
    expect(jobs6[0].payload).toEqual({ x: 1 });
    expect(jobs6[0].traceContext).toEqual({ traceparent: 'tc-val-jobs' });
    expect(jobs6[1].payload).toEqual({ x: 1 });
    expect(jobs6[1].traceContext).toBeUndefined();
    expect(jobs6[2].payload).toBe('primitive-payload');
  });

  it('should ignore complete and fail for non-existent job in MemoryJobStorage', async () => {
    const storage = new MemoryJobStorage();
    await expect(storage.complete('non-existent')).resolves.not.toThrow();
    await expect(storage.fail('non-existent', 'err')).resolves.not.toThrow();
  });
});
