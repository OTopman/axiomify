import express, { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { registry } from "../core/registry";
import { AxiomifyPlugin, AxiomifyRequest } from "../core/types";

/**
 * Creates and configures an Express application using the registered Axiomify routes.
 */
export function createExpressApp(): express.Application {
  const app = express();

  // Parse incoming JSON payloads automatically
  app.use(express.json());

  const routes = registry.getAllRoutes();
  for (const route of routes) {
    const {
      method,
      path,
      request,
      handler,
    } = route.config;
    const expressMethod = method.toLowerCase() as keyof express.Application;
    const plugins: AxiomifyPlugin<any>[] = route.config.plugins || [];

    // Phase 1: Input Validation
    const validateRequest = async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const parsedParams = request?.params
          ? await request.params.parseAsync(req.params)
          : req.params;
        const parsedQuery = request?.query
          ? await request.query.parseAsync(req.query)
          : req.query;
        const parsedBody = request?.body
          ? await request.body.parseAsync(req.body)
          : req.body;

        // Express 5 prevents mutating req.query directly.
        // We safely pass the validated data downstream via res.locals.
        res.locals.axiomify = {
          params: parsedParams || {},
          query: parsedQuery || {},
          body: parsedBody || {},
        };

        next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ error: 'Validation Error', details: error.errors });
          return;
        }
        next(error);
      }
    };

  const executeHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {

    try {
      let injectedContext = {};

      const agnosticReq: AxiomifyRequest = {
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        rawBody: req.body,
        engine: 'express',
        originalRequest: req,
      };

      // --- 1. LIFECYCLE: onRequest ---
      if (plugins.length > 0) {
        for (const plugin of plugins) {
          if (plugin.onRequest) {
            const result = await plugin.onRequest(agnosticReq);
            if (result && typeof result === 'object') {
              injectedContext = { ...injectedContext, ...result };
            }
          }
        }
      }

      // 2. Build the final context object for the handler
      const validatedData = res.locals.axiomify || {
        params: req.params,
        query: req.query,
        body: req.body,
      };

      const context = {
        params: validatedData.params,
        query: validatedData.query,
        body: validatedData.body,
        headers: req.headers as Record<string, string | string[] | undefined>,
        ...injectedContext,
      };

      // 3. Execute the developer's business logic
      const handlerResult = await handler(context);

      // 4. Validate outgoing data
      let finalResponse = route.config.response
        ? await route.config.response.parseAsync(handlerResult)
        : handlerResult;

      // --- 5. LIFECYCLE: onResponse ---
      if (plugins.length > 0) {
        // Run onResponse hooks in reverse order (onion model)
        for (const plugin of [...plugins].reverse()) {
          if (plugin.onResponse) {
            finalResponse =
              (await plugin.onResponse(finalResponse, agnosticReq)) ||
              finalResponse;
          }
        }
      }

      res.json(finalResponse);
    } catch (error) {
      // --- 6. LIFECYCLE: onError ---
      if (plugins.length > 0) {
        for (const plugin of plugins) {
          if (plugin.onError) {
            await plugin.onError(error as Error, req as any);
          }
        }
      }

      if (error instanceof Error && error.message === 'Unauthorized') {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (error instanceof z.ZodError) {
        console.error(
          `[axiomify] Response breached API contract for ${method} ${path}:`,
          error.errors,
        );
        res.status(500).json({
          error: 'Internal Server Error: Response validation failed.',
        });
        return;
      }
      next(error);
    }
  };

    // Phase 3: Mount the route
    // The spread operator allows us to inject per-route plugins (like auth) before the core logic
   app[expressMethod](path, validateRequest, executeHandler);
  }

  // Global Error Catcher
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("[axiomify] Unhandled Exception:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}
