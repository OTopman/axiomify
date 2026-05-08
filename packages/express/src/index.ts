import { ADAPTER_LOCK_TOKEN, type Axiomify } from '@axiomify/core';
import cluster from 'cluster';
import type { NextFunction, Request, Response } from 'express';
import express, { Express } from 'express';
import { Server } from 'http';
import { availableParallelism } from 'os';
import type { ListenOptions } from 'net';
import { translateRequest, translateResponse } from './translator';

export interface ExpressAdapterOptions {
  /**
   * Maximum body size for JSON and URL-encoded payloads.
   * @default '1mb'
   */
  bodyLimit?: string;
  /**
   * Express trust proxy setting. Required for correct req.ip behind load
   * balancers or nginx. Set to `1` for a single proxy hop, `2` for two hops.
   * Never set to `true` in production unless you fully control the proxy chain.
   * @default false
   */
  trustProxy?: boolean | number | string;
  /**
   * Number of worker processes for `listenClustered()`. Defaults to the
   * number of logical CPU cores.
   */
  workers?: number;
  /**
   * When true, request bodies are recursively cloned to strip
   * prototype-pollution keys (default: false). JSON.parse in V8 does not produce
   * @default true
   */
  sanitize?: boolean;
}

export class ExpressAdapter {
  private app: Express;
  private core: Axiomify;
  private server?: Server;
  private readonly _workers: number;

  constructor(coreApp: Axiomify, options: ExpressAdapterOptions = {}) {
    console.warn(
      '[axiomify] The @axiomify/express adapter is deprecated and will be removed in v6. ' +
        "It routes all requests through Axiomify's own dispatcher, then re-wraps them for " +
        "express — adding overhead without any benefit from express's native performance. " +
        'Use @axiomify/http or @axiomify/native instead.',
    );
    const { bodyLimit = '1mb', trustProxy = false } = options;

    this.core = coreApp;
    this.core.lockRoutes(ADAPTER_LOCK_TOKEN, '@axiomify/express');
    this._workers = options.workers ?? availableParallelism();
    this.app = express();

    // Required for correct req.ip when deployed behind a proxy or load balancer.
    this.app.set('trust proxy', trustProxy);

    this.app.use(express.json({ limit: bodyLimit }));
    this.app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    const sanitize = options.sanitize ?? false;

    for (const route of this.core.registeredRoutes) {
      this.app[route.method.toLowerCase() as 'get'](
        route.path,
        async (req: Request, res: Response) => {
          const axiomifyReq = translateRequest(req, sanitize);
          const axiomifyRes = translateResponse(
            res,
            this.core.serializer,
            axiomifyReq,
          );
          await this.core.handleMatchedRoute(
            ADAPTER_LOCK_TOKEN,
            axiomifyReq,
            axiomifyRes,
            route,
            req.params as Record<string, string>,
          );
        },
      );
    }

    // 404 / 405 fallback — Express exhausted its own route table before reaching
    // this handler. Axiomify's router is consulted ONLY to distinguish 405 from
    // 404, never as a primary dispatch path. No matched request ever hits this.
    this.app.use(async (req: Request, res: Response) => {
      const axiomifyReq = translateRequest(req);
      const axiomifyRes = translateResponse(
        res,
        this.core.serializer,
        axiomifyReq,
      );
      const match = this.core.router.lookup(req.method as never, req.path);
      if (match && 'error' in match) {
        axiomifyRes.header('Allow', match.allowed.join(', '));
        return axiomifyRes.status(405).send(null, 'Method Not Allowed');
      }
      return axiomifyRes.status(404).send(null, 'Route not found');
    });

    // Error handler for body-parser failures (413 Payload Too Large, 400 Bad
    // Request from malformed JSON). Must be registered AFTER all routes — this
    // is an Express constraint for 4-argument error handlers.
    this.app.use(
      (err: unknown, req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) return next(err);
        const anyErr = err as Record<string, unknown>;
        const statusCode =
          typeof anyErr.statusCode === 'number'
            ? anyErr.statusCode
            : typeof anyErr.status === 'number'
            ? anyErr.status
            : 500;
        const message =
          statusCode === 413
            ? 'Payload Too Large'
            : statusCode === 400
            ? 'Bad Request'
            : 'Internal Server Error';
        const axiomifyReq = translateRequest(req);
        const payload = this.core.serializer({
          data: null,
          message,
          statusCode,
          isError: true,
          req: axiomifyReq,
        });
        res.status(statusCode).json(payload);
      },
    );
  }

  public listen(port: number, callback?: () => void): Server {
    this.server = this.app.listen(port, callback);
    return this.server;
  }

  /**
   * Fork `workers` child processes and balance connections across them.
   *
   * KEY BEHAVIOURS — fixed in this revision:
   *
   * 1. SO_REUSEPORT (Linux) / exclusive (other platforms):
   *    Workers bind their OWN socket via `reusePort: true` (Node 16.9+) or
   *    `exclusive: true` (older Node). The kernel load-balances connections
   *    directly to workers — zero IPC overhead. Without these flags Node's
   *    cluster module silently falls back to SCHED_RR mode, where the primary
   *    accepts every connection and forwards file descriptors via IPC,
   *    bottlenecking the primary's event loop.
   *
   * 2. SCHED_NONE in primary:
   *    Set BEFORE the first cluster.fork() — frozen after the first fork.
   *    Required for SO_REUSEPORT/exclusive to take effect; otherwise the
   *    cluster module re-routes worker listen() calls back to the primary.
   *
   * 3. Crash circuit breaker:
   *    If 5+ workers crash within 30s, the primary aborts. Prevents a
   *    misconfigured worker (missing env var, bad migration) from pinning
   *    a CPU in a tight respawn loop indefinitely.
   *
   * 4. Graceful SIGTERM drain:
   *    Workers stop accepting, close idle keep-alives (Node 18.2+), then
   *    close the server. A hard deadline force-exits after gracefulTimeoutMs.
   *    The primary waits for ALL workers to exit before exiting itself.
   *
   * 5. SIGUSR2 rolling restart:
   *    `kill -USR2 <primary-pid>` restarts workers one at a time, waiting
   *    gracefulTimeoutMs between each so a replacement is up before the next
   *    is killed. Enables zero-downtime reload.
   *
   * WHEN DOES CLUSTERING ACTUALLY HELP?
   *   - Each worker on a separate physical CPU core adds genuine parallelism.
   *   - Set workers to the number of PHYSICAL cores, not logical (hyperthreaded).
   *   - On a 1-core machine, spawning 4+ workers HURTS — context switching exceeds
   *     any parallelism gain. The primary will warn on oversubscription.
   */
  public listenClustered(
    port: number,
    opts: {
      onWorkerReady?: (port: number) => void;
      onPrimary?: (pids: number[]) => void;
      onWorkerExit?: (pid: number, code: number | null) => void;
      /** Max ms to wait for in-flight requests before force-exit. @default 10000 */
      gracefulTimeoutMs?: number;
    } = {},
  ): void {
    const gracefulTimeoutMs = opts.gracefulTimeoutMs ?? 10_000;

    // ── Worker ──────────────────────────────────────────────────────────────
    if (!cluster.isPrimary) {
      // Bind worker's own socket via SO_REUSEPORT or exclusive — bypasses
      // the cluster module's primary-mediated IPC dispatch.
      const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
      const listenOpts: ListenOptions =
        nodeMajor >= 16
          ? { port, reusePort: true }
          : { port, exclusive: true };

      this.server = this.app.listen(listenOpts, () => {
        opts.onWorkerReady?.(port);
        process.send?.({ type: 'WORKER_READY', pid: process.pid });
      });

      process.once('SIGTERM', () => {
        // Stop accepting new connections; close idle keep-alives if available.
        const srv = this.server as unknown as {
          closeIdleConnections?: () => void;
          closeAllConnections?: () => void;
        };
        srv.closeIdleConnections?.();

        const deadline = setTimeout(() => {
          srv.closeAllConnections?.();
          process.exit(1);
        }, gracefulTimeoutMs);
        deadline.unref();

        this.close().finally(() => {
          clearTimeout(deadline);
          process.exit(0);
        });
      });
      return;
    }

    // ── Primary ─────────────────────────────────────────────────────────────

    // SCHED_NONE must be set BEFORE the first cluster.fork() — it is frozen
    // after the first fork. Without it, the worker's reusePort/exclusive
    // listen call is silently overridden and cluster falls back to its
    // default primary-IPC dispatch.
    cluster.schedulingPolicy = cluster.SCHED_NONE;

    const numWorkers = this._workers;
    const parallelism = availableParallelism();
    if (numWorkers > parallelism) {
      console.warn(
        `[Axiomify/express] listenClustered: workers (${numWorkers}) > ` +
        `availableParallelism (${parallelism}). ` +
        `This causes oversubscription and DEGRADES throughput. ` +
        `Set workers: ${parallelism} or omit the option to use the correct default.`,
      );
    }

    const liveWorkers = new Map<number, cluster.Worker>();
    let readyCount = 0;
    let allReadyFired = false;

    // Crash circuit breaker — if 5+ workers crash within 30s the primary
    // aborts so we never burn CPU spinning on a fundamentally broken config
    // (missing DB URL, bad migration, port conflict, etc.).
    const CRASH_THRESHOLD = 5;
    const CRASH_WINDOW_MS = 30_000;
    const crashTimes: number[] = [];

    const spawnWorker = (respawnDelayMs = 0): void => {
      setTimeout(() => {
        const w = cluster.fork();
        w.once('online', () => {
          if (w.process.pid) liveWorkers.set(w.process.pid, w);
        });
        w.on('message', (msg: { type?: string }) => {
          if (msg?.type !== 'WORKER_READY') return;
          readyCount++;
          if (!allReadyFired && readyCount >= numWorkers) {
            allReadyFired = true;
            opts.onPrimary?.([...liveWorkers.keys()]);
          }
        });
        w.on('exit', (code, signal) => {
          const pid = w.process.pid ?? 0;
          liveWorkers.delete(pid);
          opts.onWorkerExit?.(pid, code);
          // Intentional exits — do not restart, do not count toward circuit breaker.
          if (code === 0 || signal === 'SIGTERM') return;

          const now = Date.now();
          crashTimes.push(now);
          while (crashTimes.length && crashTimes[0] < now - CRASH_WINDOW_MS) crashTimes.shift();
          if (crashTimes.length >= CRASH_THRESHOLD) {
            console.error(
              `[Axiomify/express] ${crashTimes.length} workers crashed within ` +
              `${CRASH_WINDOW_MS}ms. Aborting primary to avoid a respawn loop.`,
            );
            process.exit(1);
          }

          spawnWorker(Math.min((respawnDelayMs || 50) * 2, 5_000));
        });
      }, respawnDelayMs);
    };

    process.once('SIGTERM', () => {
      if (liveWorkers.size === 0) {
        process.exit(0);
        return;
      }
      let pending = liveWorkers.size;
      for (const w of liveWorkers.values()) {
        w.once('exit', () => {
          if (--pending === 0) process.exit(0);
        });
        w.process.kill('SIGTERM');
      }
      setTimeout(() => process.exit(1), gracefulTimeoutMs + 2_000).unref();
    });

    // SIGUSR2: rolling restart for zero-downtime reload.
    process.on('SIGUSR2', () => {
      const snapshot = [...liveWorkers.values()];
      if (snapshot.length === 0) return;
      let i = 0;
      const killNext = () => {
        if (i >= snapshot.length) return;
        const w = snapshot[i++];
        if (liveWorkers.has(w.process.pid ?? -1)) {
          w.process.kill('SIGTERM');
        }
        setTimeout(killNext, gracefulTimeoutMs);
      };
      killNext();
    });

    for (let i = 0; i < numWorkers; i++) spawnWorker();
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  public get native(): Express {
    return this.app;
  }
}
