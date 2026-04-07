import { ExecutionEngine, HookManager, HookType } from './lifecycle';
import { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
  RouteSchema,
} from './types';
import { ValidationCompiler } from './validation';

export class Axiomify {
  public router = new Router();
  public engine = new ExecutionEngine();
  public validator = new ValidationCompiler();
  private hooks = new HookManager();

  // NEW: Store a flat list of definitions for plugins (OpenAPI, CLI)
  public readonly registeredRoutes: RouteDefinition[] = [];

  public addHook(type: HookType, handler: any) {
    this.hooks.add(type, handler);
    return this;
  }

  public route<S extends RouteSchema>(definition: RouteDefinition<S>): this {
    this.router.register(definition as RouteDefinition);
    this.registeredRoutes.push(definition as RouteDefinition); // Save reference

    const routeId = `${definition.method}:${definition.path}`;
    if (definition.schema) {
      this.validator.compile(routeId, definition.schema);
    }

    return this;
  }

  public async handle(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    try {
      // 🚀 1. Execute 'onRequest' BEFORE routing
      // Perfect for global rate-limiting, CORS, or initial request logging
      await this.hooks.run('onRequest', req, res);

      // 2. Match the Route
      const match = this.router.lookup(req.method, req.path);

      if (!match) {
        return res.status(404).send(null, 'Route not found');
      }

      Object.assign(req.params as any, match.params);
      const routeId = `${match.route.method}:${match.route.path}`;

      // 🚀 3. Execute 'preHandler' (Plugins & Parsers)
      // Busboy stream parsing and auth checks happen here
      await this.hooks.run('preHandler', req, res, match);

      // 4. Run Validation
      this.validator.execute(routeId, req);

      // 5. Run the Developer's Business Logic
      await this.engine.run(req, res, match.route.handler);

      // 🚀 6. Execute 'onPostHandler' (Response Modification)
      // Perfect for response serialization, audit logging, or header injection
      // (Assuming you have an onPostHandler in your HookType type)
      await this.hooks.run('onPostHandler', req, res, match);
    } catch (err: any) {
      // Centralized Error Dispatcher
      await this.handleError(err, req, res);
    }
  }

  // Add this helper method to the Axiomify class:
  private async handleError(err: any, req: AxiomifyRequest, res: AxiomifyResponse) {
    await this.hooks.run('onError', err, req, res);

    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal Server Error';

    // 🚀 Expose Zod validation issues directly to the developer
    const errorData =
      err.issues ||
      err.errors ||
      (process.env.NODE_ENV === 'development' ? { stack: err.stack } : null);

    res.status(statusCode).send(errorData, message);
  }
}
