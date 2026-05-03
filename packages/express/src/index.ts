import type { Axiomify } from '@axiomify/core';
import type { NextFunction, Request, Response } from 'express';
import express, { Express } from 'express';
import cluster from 'cluster';
import { Server } from 'http';
import { cpus } from 'os';
import { translateRequest, translateResponse } from './translator';

export interface ExpressAdapterOptions {
  /**
   * Maximum body size for JSON and URL-encoded payloads.
   * Enforced by Express body parsers on the actual stream — not a Content-Length
   * check — making this resilient to chunked transfer encoding bypasses.
   * @default '1mb'
   */
  bodyLimit?: string;
  /**
   * Express trust proxy setting. Required for correct req.ip behind load
   * balancers, nginx, or any reverse proxy. Without this, req.ip returns the
   * proxy's IP, breaking rate limiting and fingerprinting.
   *
   * Set to `1` for a single proxy hop, `2` for two hops.
   * Never set to `true` in production unless you fully control the proxy chain.
   *
   * @default false
   */
  trustProxy?: boolean | number | string;
  /**
   * Number of worker processes for `listenClustered()`. Defaults to the
   * number of logical CPU cores.
   */
  workers?: number;
}

export class ExpressAdapter {
  private app: Express;
  private core: Axiomify;
  private server?: Server;
  private readonly _workers: number;

  constructor(coreApp: Axiomify, options: ExpressAdapterOptions = {}) {
    const { bodyLimit = '1mb', trustProxy = false } = options;

    this.core = coreApp;
    this._workers = options.workers ?? cpus().length;
    this.app = express();

    // Required for correct req.ip when deployed behind a proxy or load balancer.
    this.app.set('trust proxy', trustProxy);

    // Apply body parsers globally. Express checks Content-Type before parsing
    // so these are safe to register unconditionally — they only fire for
    // matching content types.
    this.app.use(express.json({ limit: bodyLimit }));
    this.app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    // --- EXPRESS'S OWN ROUTER HANDLES ALL ROUTING ---
    // Each Axiomify route is registered directly with Express using its exact
    // HTTP method and path. Express resolves the route, extracts named params,
    // and invokes the handler. Axiomify's internal router is NOT consulted in
    // the request dispatch path — there is no double routing.
    for (const route of this.core.registeredRoutes) {
      this.app[route.method.toLowerCase() as 'get'](
        route.path,
        async (req: Request, res: Response) => {
          const axiomifyReq = translateRequest(req);
          const axiomifyRes = translateResponse(
            res,
            this.core.serializer,
            axiomifyReq,
          );
          // req.params populated by Express — no re-routing needed.
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
   * Fork `workers` child processes and start Express on each. All workers bind
   * the same port via Node.js cluster round-robin. Crashed workers restart automatically.
   *
   * @example
   * const adapter = new ExpressAdapter(app, { workers: 4 });
   * adapter.listenClustered(3000, {
   *   onWorkerReady: (port) => console.log(`[${process.pid}] :${port}`),
   *   onPrimary: (pids) => console.log('Workers:', pids),
   * });
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
      this.listen(port, () => opts.onWorkerReady?.(port));
      return;
    }
    const pids: number[] = [];
    for (let i = 0; i < this._workers; i++) {
      const w = cluster.fork();
      pids.push(w.process.pid ?? 0);
      w.on('exit', (code, signal) => {
        opts.onWorkerExit?.(w.process.pid ?? 0, code);
        if (code !== 0 && signal !== 'SIGTERM') cluster.fork();
      });
    }
    opts.onPrimary?.(pids);
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
