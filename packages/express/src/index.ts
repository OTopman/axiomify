import type { Axiomify } from '@axiomify/core';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import { Server } from 'http';
import { translateRequest, translateResponse } from './translator';

export interface ExpressAdapterOptions {
  /**
   * Maximum body size for JSON and URL-encoded payloads.
   * Enforced by the Express body parsers — not dependent on Content-Length.
   * @default '1mb'
   */
  bodyLimit?: string;
  /**
   * Express trust proxy setting. Required for correct req.ip behind load
   * balancers, nginx, or any reverse proxy. Without this, req.ip returns the
   * proxy's IP instead of the client's, breaking rate limiting and fingerprinting.
   *
   * Set to `1` for a single proxy hop, `2` for two hops, or `true` to trust all.
   * Never set to `true` in production unless you fully control the proxy chain.
   *
   * @default false
   */
  trustProxy?: boolean | number | string;
}

export class ExpressAdapter {
  private app: Express;
  private core: Axiomify;
  private server?: Server;

  constructor(coreApp: Axiomify, options: ExpressAdapterOptions = {}) {
    const { bodyLimit = '1mb', trustProxy = false } = options;

    this.core = coreApp;
    this.app = express();

    // Required for correct req.ip when deployed behind a proxy/load balancer.
    // Without this, all requests appear to originate from the proxy IP, which
    // breaks rate limiting, fingerprinting, and audit logs.
    this.app.set('trust proxy', trustProxy);

    // Instantiate parsers once at boot with explicit size limits.
    // These limits are enforced on the actual body stream, unlike the
    // Content-Length header check in @axiomify/security which can be bypassed
    // by chunked transfer encoding.
    const jsonParser = express.json({ limit: bodyLimit });
    const urlencodedParser = express.urlencoded({
      extended: true,
      limit: bodyLimit,
    });

    this.app.use((req, res, next) => {
      const match = this.core.router.lookup(req.method as never, req.path);
      if (!match) return next();

      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json'))
        return jsonParser(req, res, next);
      if (contentType.includes('application/x-www-form-urlencoded'))
        return urlencodedParser(req, res, next);

      next();
    });

    this.app.use(
      (err: any, req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) return next(err);
        const statusCode =
          typeof err?.statusCode === 'number'
            ? err.statusCode
            : typeof err?.status === 'number'
              ? err.status
              : 500;
        const message =
          statusCode === 413
            ? 'Payload Too Large'
            : statusCode === 400
              ? 'Bad Request'
              : 'Internal Server Error';
        const axiomifyReq = translateRequest(req);
        const payload = this.core.serializer(
          null,
          message,
          statusCode,
          true,
          axiomifyReq,
        );
        res.status(statusCode).json(payload);
      },
    );

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
          await this.core.handleMatchedRoute(
            axiomifyReq,
            axiomifyRes,
            route,
            req.params as Record<string, string>,
          );
        },
      );
    }

    this.app.all('*', async (req: Request, res: Response) => {
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
  }

  public listen(port: number, callback?: () => void): Server {
    this.server = this.app.listen(port, callback);
    return this.server;
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
