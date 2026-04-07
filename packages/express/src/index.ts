import type { Axiomify } from '@axiomify/core';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { translateRequest, translateResponse } from './translator';

export class ExpressAdapter {
  private app: Express;
  private core: Axiomify;

  constructor(coreApp: Axiomify) {
    this.core = coreApp;
    this.app = express();

    // Essential Express middleware for parsing
    this.app.use((req, res, next) => {
      const contentType = req.headers['content-type'] || '';

      // 1. If it's standard JSON, let Express handle it
      if (contentType.includes('application/json')) {
        return express.json()(req, res, next);
      }

      // 2. If it's a file upload, DO NOT touch the stream.
      // Just pass it to the next step (Axiomify's upload plugin).
      next();
    });

    // The Hijack: Catch all traffic and route it to Axiomify's Radix Engine
    this.app.all('*', async (req: Request, res: Response) => {
      const axiomifyReq = translateRequest(req);
      const axiomifyRes = translateResponse(res);

      await this.core.handle(axiomifyReq, axiomifyRes);
    });
  }

  /**
   * Bootstraps the server.
   */
  public listen(port: number, callback?: () => void): import('http').Server {
    return this.app.listen(port, callback);
  }

  /**
   * Exposes the underlying Express app just in case legacy integration is needed,
   * though using this breaks the framework-agnostic guarantee.
   */
  public get native(): Express {
    return this.app;
  }
}
