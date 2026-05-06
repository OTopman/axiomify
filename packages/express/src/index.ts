import type { Axiomify } from '@axiomify/core';
import cluster from 'cluster';
import type { NextFunction, Request, Response } from 'express';
import express, { Express } from 'express';
import { Server } from 'http';
import { cpus } from 'os';
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
   * When true (default), request bodies are recursively sanitized to strip
   * prototype-pollution keys. Set to false for fully trusted body sources.
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
    const { bodyLimit = '1mb', trustProxy = false } = options;

    this.core = coreApp;
    // Use the public lockRoutes — no more any-cast.
    this.core.lockRoutes('@axiomify/express');
    this._workers = options.workers ?? cpus().length;
    this.app = express();

    // Required for correct req.ip when deployed behind a proxy or load balancer.
    this.app.set('trust proxy', trustProxy);

    this.app.use(express.json({ limit: bodyLimit }));
    this.app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    const sanitize = options.sanitize ?? true;

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
   * Fork `workers` child processes and start Express on each.
   * SIGTERM is forwarded to workers. `onPrimary` fires only after all workers
   * are ready — not immediately after forking.
   */
  public listenClustered(
    port: number,
    opts: {
      onWorkerReady?: (port: number) => void;
      onPrimary?: (pids: number[]) => void;
      onWorkerExit?: (pid: number, code: number | null) => void;
    } = {},
  ): void {
    if (!cluster.isPrimary) {
      this.listen(port, () => {
        opts.onWorkerReady?.(port);
        process.send?.({ type: 'WORKER_READY', pid: process.pid });
      });
      process.once('SIGTERM', () => {
        this.close().finally(() => process.exit(0));
      });
      return;
    }

    const numWorkers = this._workers;
    const liveWorkers = new Map<number, cluster.Worker>();
    let readyCount = 0;

    const spawnWorker = () => {
      const w = cluster.fork();
      w.once('online', () => {
        if (w.process.pid) liveWorkers.set(w.process.pid, w);
      });
      w.on('message', (msg: { type?: string }) => {
        if (msg?.type === 'WORKER_READY') {
          readyCount++;
          if (readyCount === numWorkers)
            opts.onPrimary?.([...liveWorkers.keys()]);
        }
      });
      w.on('exit', (code, signal) => {
        const pid = w.process.pid ?? 0;
        liveWorkers.delete(pid);
        opts.onWorkerExit?.(pid, code);
        if (code !== 0 && signal !== 'SIGTERM') spawnWorker();
      });
    };

    process.once('SIGTERM', () => {
      for (const w of liveWorkers.values()) w.process.kill('SIGTERM');
      process.exit(0);
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
