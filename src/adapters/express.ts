import express, { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { registry } from "../core/registry";

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
      response,
      handler,
      plugins = [],
    } = route.config;
    const expressMethod = method.toLowerCase() as keyof express.Application;

    // Phase 1: Input Validation
    const validateRequest = async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
      
        // We use parseAsync to support both synchronous and asynchronous Zod refinements
        const parsedParams = request?.params
          ? await request.params!.parseAsync(request.params)
          : req.params;
        const parsedQuery = request?.query
          ? await request.query!.parseAsync(request.query)
          : req.query;
        const parsedBody = request?.body
          ? await request.body!.parseAsync(request.body)
          : req.body;

        // Overwrite the Express request objects with the strongly-typed, stripped data
        req.params = parsedParams;
        req.query = parsedQuery;
        req.body = parsedBody;

        next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ error: "Validation Error", details: error.errors });
          return;
        }
        next(error);
      }
    };

    // Phase 2: Execution & Output Validation
    const executeHandler = async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        let injectedContext = {};

        // 1. Sequentially execute plugins and merge their returned data
        if (plugins && plugins.length > 0) {
          for (const plugin of plugins) {
            // Pass the raw request to the plugin
            const result = await plugin(req);
            if (result && typeof result === "object") {
              injectedContext = { ...injectedContext, ...result };
            }
          }
        }

        // 2. Build the final context object for the handler
        const context = {
          params: req.params,
          query: req.query,
          body: req.body,
          headers: req.headers as Record<string, string | string[] | undefined>,
          ...injectedContext, // Spread the accumulated plugin data here
        };

        // 3. Execute the developer's business logic
        const handlerResult = await handler(context);

        // 4. Validate outgoing data
        const validatedResponse = await response.parseAsync(handlerResult);
        res.json(validatedResponse);
      } catch (error) {
        // If a plugin throws (e.g., "Unauthorized"), catch it here and format the error
        if (error instanceof Error && error.message === "Unauthorized") {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        if (error instanceof z.ZodError) {
          console.error(
            `[axiomify] Response breached API contract for ${method} ${path}:`,
            error.errors,
          );
          // We return a 500 here because the client did nothing wrong; the backend returned bad data.
          res.status(500).json({
            error: "Internal Server Error: Response validation failed.",
          });
          return;
        }
        next(error);
      }
    };

    // Phase 3: Mount the route
    // The spread operator allows us to inject per-route plugins (like auth) before the core logic
    app[expressMethod](path, ...plugins, validateRequest, executeHandler);
  }

  // Global Error Catcher
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("[axiomify] Unhandled Exception:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}
