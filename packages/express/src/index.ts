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

    // Instantiate memory-heavy parsers ONCE during boot
    const jsonParser = express.json();
    const urlencodedParser = express.urlencoded({ extended: true });

    this.app.use((req, res, next) => {
      const match = this.core.router.lookup(req.method as any, req.path);
      if (!match) return next();

      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json'))
        return jsonParser(req, res, next);
      if (contentType.includes('application/x-www-form-urlencoded'))
        return urlencodedParser(req, res, next);

      next();
    });

    // The Hijack: Catch all traffic and route it to Axiomify's Radix Engine
    this.app.all('*', async (req: Request, res: Response) => {
      const axiomifyReq = translateRequest(req);
      const axiomifyRes = translateResponse(res, this.core.serializer);

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
