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

  // 🚀 1. Use the new unified HookEngine
  public readonly hooks = new HookManager();

  private readonly _routes: RouteDefinition[] = [];

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this._routes;
  }

  public addHook(type: HookType, handler: any) {
    this.hooks.add(type, handler);
    return this;
  }

  public route<S extends RouteSchema>(definition: RouteDefinition<S>): this {
    this.router.register(definition as RouteDefinition);
    this._routes.push(definition as RouteDefinition);

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
      await this.hooks.run('onRequest', req, res);

      const match = this.router.lookup(req.method, req.path);

      if (!match) {
        return res.status(404).send(null, 'Route not found');
      }

      Object.assign(req.params as any, match.params);
      const routeId = `${match.route.method}:${match.route.path}`;

      // 🚀 2. Use the correct unified name: 'onPreHandler'
      await this.hooks.run('onPreHandler', req, res, match);

      this.validator.execute(routeId, req);

      await this.engine.run(req, res, match.route.handler);

      // 🚀 3. Run post handler
      await this.hooks.run('onPostHandler', req, res, match);
    } catch (err: any) {
      await this.handleError(err, req, res);
    }
  }

  private async handleError(
    err: any,
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) {
    await this.hooks.run('onError', err, req, res);

    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal Server Error';

    const errorData =
      err.issues ||
      err.errors ||
      (process.env.NODE_ENV === 'development' ? { stack: err.stack } : null);

    res.status(statusCode).send(errorData, message);
  }
}
