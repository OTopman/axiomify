export interface Job {
  id: string;
  queue: string;
  name: string;
  payload: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  runAt: number; // epoch ms
  attempts: number;
  maxAttempts: number;
  error?: string;
  lockedAt?: number;
  traceContext?: Record<string, string>;
}

export interface JobStorage {
  save(job: Job): Promise<void>;
  acquireNext(queue: string, lockDurationMs: number): Promise<Job | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, retryInMs?: number): Promise<void>;
  getJobs(queue?: string): Promise<Job[]>;
  clear(): Promise<void>;
}

/**
 * 1. Memory Storage Adapter (for testing and local dev)
 */
export class MemoryJobStorage implements JobStorage {
  private jobs = new Map<string, Job>();

  public async save(job: Job): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  public async acquireNext(queue: string, lockDurationMs: number): Promise<Job | null> {
    const now = Date.now();
    const candidates = Array.from(this.jobs.values())
      .filter((j) => j.queue === queue && j.status === 'pending' && j.runAt <= now)
      .sort((a, b) => b.priority - a.priority); // higher priority first

    const job = candidates[0];
    if (!job) return null;

    job.status = 'running';
    job.lockedAt = now + lockDurationMs;
    this.jobs.set(job.id, job);
    return { ...job };
  }

  public async complete(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'completed';
      this.jobs.set(id, job);
    }
  }

  public async fail(id: string, error: string, retryInMs?: number): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.attempts += 1;
      job.error = error;
      if (job.attempts < job.maxAttempts && retryInMs !== undefined) {
        job.status = 'pending';
        job.runAt = Date.now() + retryInMs;
      } else {
        job.status = 'failed';
      }
      this.jobs.set(id, job);
    }
  }

  public async getJobs(queue?: string): Promise<Job[]> {
    const list = Array.from(this.jobs.values());
    if (queue) return list.filter((j) => j.queue === queue);
    return list;
  }

  public async clear(): Promise<void> {
    this.jobs.clear();
  }
}

/**
 * 2. SQL Database Storage Adapter (reusing existing Prisma/Drizzle/pg client)
 */
export class SQLJobStorage implements JobStorage {
  constructor(private client: any) {
    if (!client) {
      throw new Error('[Axiomify Jobs] SQL client database instance is required.');
    }
  }

  private async executeQuery(sql: string, params: any[] = []): Promise<any[]> {
    // 1. Prisma detection
    if (typeof this.client.$queryRawUnsafe === 'function') {
      return this.client.$queryRawUnsafe(sql, ...params);
    }
    // 2. Drizzle client or raw Pg driver detection
    if (typeof this.client.query === 'function') {
      const res = await this.client.query(sql, params);
      return res.rows || res;
    }
    // 3. Simple execution fallback
    if (typeof this.client.execute === 'function') {
      const res = await this.client.execute(sql, params);
      return res.rows || res;
    }
    throw new Error('[Axiomify Jobs] Unsupported database client interface. Make sure it supports .query(), .execute() or .$queryRawUnsafe()');
  }

  public async save(job: Job): Promise<void> {
    // Check if job exists
    const checkSql = 'SELECT id FROM axiomify_jobs WHERE id = ? LIMIT 1';
    const existing = await this.executeQuery(checkSql.replace(/\?/g, '$1'), [job.id]);
    
    if (existing && existing.length > 0) {
      const updateSql = `
        UPDATE axiomify_jobs 
        SET status = $1, priority = $2, runAt = $3, attempts = $4, maxAttempts = $5, error = $6, lockedAt = $7
        WHERE id = $8
      `;
      await this.executeQuery(updateSql, [
        job.status,
        job.priority,
        job.runAt,
        job.attempts,
        job.maxAttempts,
        job.error || null,
        job.lockedAt || null,
        job.id
      ]);
    } else {
      // Serialize traceContext transparently into the payload JSON to prevent requiring table schema updates
      let payloadToSave = job.payload;
      if (job.traceContext) {
        if (payloadToSave && typeof payloadToSave === 'object' && !Array.isArray(payloadToSave)) {
          payloadToSave = {
            ...payloadToSave,
            _traceContext: job.traceContext
          };
        } else {
          payloadToSave = {
            __value: payloadToSave,
            _traceContext: job.traceContext
          };
        }
      }

      const insertSql = `
        INSERT INTO axiomify_jobs (id, queue, name, payload, status, priority, runAt, attempts, maxAttempts, error, lockedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;
      await this.executeQuery(insertSql, [
        job.id,
        job.queue,
        job.name,
        JSON.stringify(payloadToSave),
        job.status,
        job.priority,
        job.runAt,
        job.attempts,
        job.maxAttempts,
        job.error || null,
        job.lockedAt || null
      ]);
    }
  }

  public async acquireNext(queue: string, lockDurationMs: number): Promise<Job | null> {
    const now = Date.now();
    
    // Select and lock atomically
    const selectSql = `
      SELECT * FROM axiomify_jobs 
      WHERE queue = $1 AND status = 'pending' AND runAt <= $2
      ORDER BY priority DESC, runAt ASC 
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const rows = await this.executeQuery(selectSql, [queue, now]);
    const row = rows?.[0];
    if (!row) return null;

    const lockedAt = now + lockDurationMs;
    const updateSql = `
      UPDATE axiomify_jobs 
      SET status = 'running', lockedAt = $1 
      WHERE id = $2
    `;
    await this.executeQuery(updateSql, [lockedAt, row.id]);

    const rawPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    let payload = rawPayload;
    let traceContext = undefined;
    if (payload && typeof payload === 'object') {
      if ('_traceContext' in payload) {
        traceContext = payload._traceContext;
        if ('__value' in payload) {
          payload = payload.__value;
        } else {
          const { _traceContext: _, ...rest } = payload;
          payload = rest;
        }
      }
    }

    return {
      id: row.id,
      queue: row.queue,
      name: row.name,
      payload,
      status: 'running',
      priority: row.priority,
      runAt: Number(row.runAt),
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      error: row.error,
      lockedAt,
      traceContext,
    };
  }

  public async complete(id: string): Promise<void> {
    const sql = `UPDATE axiomify_jobs SET status = 'completed', lockedAt = NULL WHERE id = $1`;
    await this.executeQuery(sql, [id]);
  }

  public async fail(id: string, error: string, retryInMs?: number): Promise<void> {
    const now = Date.now();
    const selectSql = 'SELECT attempts, maxAttempts FROM axiomify_jobs WHERE id = $1';
    const rows = await this.executeQuery(selectSql, [id]);
    const row = rows?.[0];
    if (!row) return;

    const attempts = row.attempts + 1;
    const maxAttempts = row.maxAttempts;

    if (attempts < maxAttempts && retryInMs !== undefined) {
      const runAt = now + retryInMs;
      const sql = `
        UPDATE axiomify_jobs 
        SET status = 'pending', attempts = $1, error = $2, runAt = $3, lockedAt = NULL 
        WHERE id = $4
      `;
      await this.executeQuery(sql, [attempts, error, runAt, id]);
    } else {
      const sql = `
        UPDATE axiomify_jobs 
        SET status = 'failed', attempts = $1, error = $2, lockedAt = NULL 
        WHERE id = $3
      `;
      await this.executeQuery(sql, [attempts, error, id]);
    }
  }

  public async getJobs(queue?: string): Promise<Job[]> {
    const sql = queue 
      ? 'SELECT * FROM axiomify_jobs WHERE queue = $1 ORDER BY runAt DESC'
      : 'SELECT * FROM axiomify_jobs ORDER BY runAt DESC';
    const rows = await this.executeQuery(sql, queue ? [queue] : []);
    
    return (rows || []).map((row) => {
      const rawPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      let payload = rawPayload;
      let traceContext = undefined;
      if (payload && typeof payload === 'object') {
        if ('_traceContext' in payload) {
          traceContext = payload._traceContext;
          if ('__value' in payload) {
            payload = payload.__value;
          } else {
            const { _traceContext: _, ...rest } = payload;
            payload = rest;
          }
        }
      }

      return {
        id: row.id,
        queue: row.queue,
        name: row.name,
        payload,
        status: row.status,
        priority: row.priority,
        runAt: Number(row.runAt),
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        error: row.error,
        lockedAt: row.lockedAt ? Number(row.lockedAt) : undefined,
        traceContext,
      };
    });
  }

  public async clear(): Promise<void> {
    await this.executeQuery('DELETE FROM axiomify_jobs');
  }
}

/**
 * 3. Redis Job Storage Adapter
 */
export class RedisJobStorage implements JobStorage {
  constructor(private client: any) {
    if (!client) {
      throw new Error('[Axiomify Jobs] Redis client is required.');
    }
  }

  private async get(key: string): Promise<string | null> {
    const fn = this.client.get || this.client.GET;
    return fn.call(this.client, key);
  }

  private async set(key: string, value: string): Promise<void> {
    const fn = this.client.set || this.client.SET;
    await fn.call(this.client, key, value);
  }

  private async del(key: string): Promise<void> {
    const fn = this.client.del || this.client.DEL;
    await fn.call(this.client, key);
  }

  private async sadd(key: string, member: string): Promise<void> {
    const fn = this.client.sadd || this.client.sAdd || this.client.SADD;
    await fn.call(this.client, key, member);
  }

  private async srem(key: string, member: string): Promise<void> {
    const fn = this.client.srem || this.client.sRem || this.client.SREM;
    await fn.call(this.client, key, member);
  }

  private async smembers(key: string): Promise<string[]> {
    const fn = this.client.smembers || this.client.sMembers || this.client.SMEMBERS;
    return fn.call(this.client, key);
  }

  private async zadd(key: string, score: number, member: string): Promise<void> {
    const fn = this.client.zadd || this.client.zAdd || this.client.ZADD;
    try {
      await fn.call(this.client, key, score, member);
    } catch {
      await fn.call(this.client, key, { score, value: member });
    }
  }

  private async zrem(key: string, member: string): Promise<void> {
    const fn = this.client.zrem || this.client.zRem || this.client.ZREM;
    await fn.call(this.client, key, member);
  }

  private async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const fn = this.client.zrangebyscore || this.client.zRangeByScore || this.client.ZRANGEBYSCORE;
    return fn.call(this.client, key, min, max);
  }

  private async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    const fn = this.client.mget || this.client.mGet || this.client.MGET;
    return fn.call(this.client, keys);
  }

  public async save(job: Job): Promise<void> {
    const key = `axiomify:job:${job.id}`;
    await this.set(key, JSON.stringify(job));
    await this.sadd('axiomify:jobs:all', job.id);
    await this.sadd(`axiomify:queue:${job.queue}:jobs`, job.id);

    if (job.status === 'pending') {
      await this.zadd(`axiomify:queue:${job.queue}:pending_zset`, job.runAt, job.id);
    } else {
      await this.zrem(`axiomify:queue:${job.queue}:pending_zset`, job.id);
    }
  }

  public async acquireNext(queue: string, lockDurationMs: number): Promise<Job | null> {
    const now = Date.now();
    const pendingZsetKey = `axiomify:queue:${queue}:pending_zset`;

    const jobIds = await this.zrangebyscore(pendingZsetKey, 0, now);
    if (!jobIds || jobIds.length === 0) return null;

    const keys = jobIds.map((id) => `axiomify:job:${id}`);
    const rawJobs = await this.mget(keys);

    const candidates: Job[] = [];
    for (const raw of rawJobs) {
      if (raw) {
        try {
          const job = JSON.parse(raw) as Job;
          if (job.status === 'pending' && job.runAt <= now) {
            candidates.push(job);
          }
        } catch {}
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.runAt - b.runAt;
    });

    const targetJob = candidates[0];
    const lockKey = `axiomify:job:${targetJob.id}`;
    const lockedAt = now + lockDurationMs;

    const evalFn = this.client.eval || this.client.EVAL;
    if (typeof evalFn === 'function') {
      const lockScript = `
        local rawJob = redis.call('GET', KEYS[1])
        if not rawJob then return nil end
        local job = cjson.decode(rawJob)
        if job.status == 'pending' and tonumber(job.runAt) <= tonumber(ARGV[2]) then
          job.status = 'running'
          job.lockedAt = tonumber(ARGV[1])
          redis.call('SET', KEYS[1], cjson.encode(job))
          redis.call('ZREM', KEYS[2], job.id)
          return cjson.encode(job)
        end
        return nil
      `;

      try {
        let result: any;
        if (typeof this.client.evalsha === 'function') {
          result = await evalFn.call(this.client, lockScript, 2, lockKey, pendingZsetKey, lockedAt.toString(), now.toString());
        } else {
          result = await evalFn.call(this.client, {
            script: lockScript,
            keys: [lockKey, pendingZsetKey],
            arguments: [lockedAt.toString(), now.toString()]
          });
        }

        if (result) {
          return JSON.parse(result) as Job;
        }
        return null;
      } catch (err) {
        // Fall back to optimistic lock below
      }
    }

    const freshRaw = await this.get(lockKey);
    if (!freshRaw) return null;
    const freshJob = JSON.parse(freshRaw) as Job;
    if (freshJob.status !== 'pending' || freshJob.runAt > now) {
      return null;
    }

    freshJob.status = 'running';
    freshJob.lockedAt = lockedAt;
    await this.set(lockKey, JSON.stringify(freshJob));
    await this.zrem(pendingZsetKey, freshJob.id);

    return freshJob;
  }

  public async complete(id: string): Promise<void> {
    const key = `axiomify:job:${id}`;
    const raw = await this.get(key);
    if (!raw) return;
    const job = JSON.parse(raw) as Job;
    job.status = 'completed';
    job.lockedAt = undefined;
    await this.set(key, JSON.stringify(job));
    await this.zrem(`axiomify:queue:${job.queue}:pending_zset`, id);
  }

  public async fail(id: string, error: string, retryInMs?: number): Promise<void> {
    const key = `axiomify:job:${id}`;
    const raw = await this.get(key);
    if (!raw) return;
    const job = JSON.parse(raw) as Job;
    
    job.attempts += 1;
    job.error = error;
    job.lockedAt = undefined;

    if (job.attempts < job.maxAttempts && retryInMs !== undefined) {
      job.status = 'pending';
      job.runAt = Date.now() + retryInMs;
      await this.set(key, JSON.stringify(job));
      await this.zadd(`axiomify:queue:${job.queue}:pending_zset`, job.runAt, id);
    } else {
      job.status = 'failed';
      await this.set(key, JSON.stringify(job));
      await this.zrem(`axiomify:queue:${job.queue}:pending_zset`, id);
    }
  }

  public async getJobs(queue?: string): Promise<Job[]> {
    const setKey = queue ? `axiomify:queue:${queue}:jobs` : 'axiomify:jobs:all';
    const ids = await this.smembers(setKey);
    if (!ids || ids.length === 0) return [];

    const keys = ids.map((id) => `axiomify:job:${id}`);
    const raw = await this.mget(keys);
    const jobs: Job[] = [];
    for (const r of raw) {
      if (r) {
        try {
          jobs.push(JSON.parse(r));
        } catch {}
      }
    }
    return jobs.sort((a, b) => b.runAt - a.runAt);
  }

  public async clear(): Promise<void> {
    const ids = await this.smembers('axiomify:jobs:all');
    if (ids && ids.length > 0) {
      const keys = ids.map((id) => `axiomify:job:${id}`);
      for (const key of keys) {
        await this.del(key);
      }
    }
    await this.del('axiomify:jobs:all');
    
    const keysFn = this.client.keys || this.client.KEYS;
    if (typeof keysFn === 'function') {
      try {
        const axiomifyKeys = await keysFn.call(this.client, 'axiomify:*');
        for (const k of axiomifyKeys) {
          await this.del(k);
        }
      } catch {}
    }
  }
}
