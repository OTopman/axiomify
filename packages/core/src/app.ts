import {
  ExecutionEngine,
  HookHandlerMap,
  HookManager,
  HookType,
} from './lifecycle';
import { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  PluginHandler,
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
  private readonly _plugins = new Map<string, PluginHandler>();

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this._routes;
  }

  public registerPlugin(name: string, handler: PluginHandler): this {
    if (this._plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered.`);
    }
    this._plugins.set(name, handler);
    return this;
  }

  public addHook<T extends HookType>(
    type: T,
    handler: HookHandlerMap[T],
  ): this {
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
      if (!match) return res.status(404).send(null, 'Route not found');

      Object.assign(req.params as any, match.params);
      const routeId = `${match.route.method}:${match.route.path}`;

      await this.hooks.run('onPreHandler', req, res, match);

      const routePlugins = match.route.plugins ?? [];
      for (const name of routePlugins) {
        const plugin = this._plugins.get(name);
        if (!plugin) {
          throw new Error(
            `Plugin "${name}" is not registered. Call app.registerPlugin() before app.route().`,
          );
        }
        await plugin(req, res);
        if (res.headersSent) return;
      }

      this.validator.execute(routeId, req);

      let responsePayload: unknown = undefined;
      const originalSend = res.send;
      res.send = (data: any, message?: string) => {
        responsePayload = data;
        return originalSend.call(res, data, message);
      };

      await this.engine.run(req, res, match.route.handler);
      this.validator.validateResponse(routeId, responsePayload);

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

    // If a hook already sent a response (like 401 Unauthorized), bail out to prevent a crash.
    if (res.headersSent) return;

    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal Server Error';

    const errorData =
      err.issues ||
      err.errors ||
      (process.env.NODE_ENV === 'development' ? { stack: err.stack } : null);

    res.status(statusCode).send(errorData, message);
  }
}
