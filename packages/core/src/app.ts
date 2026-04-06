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
    // 1. Match the Route (You should already have this logic)
    const match = this.router.lookup(req.method, req.path);

    if (!match) {
      return res.status(404).send(null, 'Route not found');
    }

    Object.assign(req.params as any, match.params);
    const routeId = `${match.route.method}:${match.route.path}`;

    try {

      console.log(`\n[ENGINE] Request arrived for: ${match.route.path}`);
      console.log(`[ENGINE] About to run 'preHandler' hooks...`);
      // 🚀 2. Run Plugins & Parsers FIRST
      // This allows Busboy to consume the stream and attach req.body and req.files
      await this.hooks.run('preHandler', req, res, match);

      console.log(
        `[ENGINE] 'preHandler' hooks finished. Moving to validation...`,
      );

      // 🚀 3. Run Validation SECOND
      // Now Zod can securely check the fully populated req.body
      this.validator.execute(routeId, req);

      // 4. Run the Developer's Business Logic
      await this.engine.run(req, res, match.route.handler);
    } catch (err: any) {
      // Centralized Error Dispatcher
      this.handleError(err, req, res);
    }
  }

  // Add this helper method to the Axiomify class:
  private handleError(err: any, req: AxiomifyRequest, res: AxiomifyResponse) {
    this.hooks.run('onError', err, req, res);

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
