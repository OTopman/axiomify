import express, { NextFunction, Request, Response } from 'express';
import { registry } from '../core/registry';
import { AxiomifyConfig, AxiomifyRequest } from '../core/types';
import { executePipeline } from '../runtime/pipeline';

export function createExpressApp(
  config: AxiomifyConfig = {},
): express.Application {
  const app = express();

  // Native Security Headers (Zero-Dependency Helmet)
  if (config.helmet) {
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    });
  }

  // Native CORS Middleware (Zero-Dependency Cors)
  if (config.cors) {
    app.use((req, res, next) => {
      const origin =
        typeof config.cors === 'object' && config.cors.origin
          ? config.cors.origin
          : '*';
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );

      if (typeof config.cors === 'object' && config.cors.credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      // Handle Preflight natively
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  const limit = config.bodyLimit || '1mb';
  app.use(express.json({ limit }));

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

          const result = await executePipeline(route.config, agnosticReq);

          // Natively support the multi-status architecture
          const status = (result as any)?.status
            ? Number((result as any).status)
            : 200;
          const data =
            (result as any)?.data !== undefined ? (result as any).data : result;

          res.status(status).json(data);
        } catch (error: any) {
          // Intercept Zod errors and return a clean 400 JSON response
          if (error?.name === 'ZodError') {
            res.status(400).json({
              error: 'Validation Error',
              details: error.errors,
            });
            return;
          }

          next(error);
        }
      },
    );
  }

  return app;
}
