import express, { NextFunction, Request, Response } from 'express';
import { registry } from '../core/registry';
import { AxiomifyRequest } from '../core/types';
import { executePipeline } from '../runtime/pipeline';

export function createExpressApp(): express.Application {
  const app = express();
  app.use(express.json());

  const routes = registry.getAllRoutes();

  for (const route of routes) {
    const { method, path } = route.config;
    const expressMethod = method.toLowerCase() as keyof express.Application;

    app[expressMethod](
      path,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const agnosticReq: AxiomifyRequest<Request> = {
            method: req.method,
            url: req.originalUrl,
            path: req.path,
            query: req.query as Record<string, unknown>,
            params: req.params as Record<string, unknown>,
            headers: req.headers,
            rawBody: req.body,
            engine: 'express',
            originalRequest: req,
          };

          // Delegate entirely to the unified pipeline
          const result = await executePipeline(route.config, agnosticReq);
          res.json(result);
        } catch (error: unknown) {
          if (error instanceof Error) {
            if (error.name === 'ZodError') {
              res.status(400).json({
                error: 'Validation Error',
                details: (error as Error & { errors: unknown }).errors,
              });
              return;
            }
            if (error.message === 'Unauthorized') {
              res.status(401).json({ error: 'Unauthorized' });
              return;
            }
          }
          next(error);
        }
      },
    );
  }

  // Global Error Catcher
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error('[axiomify] Unhandled Exception:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });
  return app;
}
