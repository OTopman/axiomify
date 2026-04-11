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
  PluginName,
  RouteDefinition,
  RouteGroup,
  RouteSchema,
} from './types';
import { ValidationCompiler } from './validation';

export interface AxiomifyOptions {
  timeout?: number; // Default request timeout in ms. 0 = disabled. Default: 0.
}

export type SerializerFn = (
  data: any,
  message?: string,
  statusCode?: number,
  isError?: boolean,
) => any;

export class Axiomify {
  public router = new Router();
  public engine = new ExecutionEngine();
  public validator = new ValidationCompiler();

  // 🚀 1. Use the new unified HookEngine
  public readonly hooks = new HookManager();

  private readonly _routes: RouteDefinition[] = [];
  private readonly _plugins = new Map<string, PluginHandler>();
  private readonly _timeout: number;

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this._routes;
  }

  constructor(options: AxiomifyOptions = {}) {
    this._timeout = options.timeout ?? 0;
  }

  public registerPlugin(name: PluginName, handler: PluginHandler): this {
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

  // Default Serializer (Overridable)
  public serializer: SerializerFn = (data, message, statusCode, isError) => ({
    status: isError || (statusCode && statusCode >= 400) ? 'failed' : 'success',
    message:
      message ||
      (isError || (statusCode && statusCode >= 400)
        ? 'Error'
        : 'Operation successful'),
    data,
  });

  public setSerializer(fn: SerializerFn): this {
    this.serializer = fn;
    return this;
  }

  // Route Grouping
  public group(prefix: string, callback: (group: RouteGroup) => void): this {
    const groupProxy: RouteGroup = {
      route: <S extends RouteSchema>(def: RouteDefinition<S>) => {
        const scopedPath =
          (prefix + def.path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        return this.route({ ...def, path: scopedPath });
      },
      group: (subPrefix, subCallback) => {
        this.group((prefix + subPrefix).replace(/\/+/g, '/'), subCallback);
        return groupProxy;
      },
    };
    callback(groupProxy);
    return this;
  }

  public async handle(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    try {
      await this.hooks.run('onRequest', req, res);
      if (res.headersSent) return;

      const match = this.router.lookup(req.method, req.path);

      // 1. Handle 404 (Eliminates 'null' from the union)
      if (!match) {
        return res.status(404).send(null, 'Route not found');
      }

      // 2. Handle 405 (Eliminates the '{ error, allowed }' object from the union)
      if ('error' in match) {
        res.header('Allow', match.allowed.join(', '));
        return res.status(405).send(null, 'Method Not Allowed');
      }

      // 3. TypeScript now mathematically GUARANTEES match is `{ route, params }`
      const { route, params } = match;

      Object.assign(req.params as any, params);
      const routeId = `${route.method}:${route.path}`;

      // This is now 100% type-safe
      await this.hooks.run('onPreHandler', req, res, match);

      // Halt execution if a global hook (like Rate Limit) sends a response!
      if (res.headersSent) return;

      const routePlugins = route.plugins ?? [];
      for (const name of routePlugins) {
        const plugin = this._plugins.get(name as string);
        if (!plugin)
          throw new Error(`Plugin "${name as string}" is not registered.`);
        await plugin(req, res);
        if (res.headersSent) return;
      }

      this.validator.execute(routeId, req);

      let responsePayload: unknown = undefined;
      const originalSend = res.send;

      res.send = (data: any, message?: string) => {
        responsePayload = data;
        // Expose payload directly on the response object for the Logger plugin
        (res as any).payload = data;
        (res as any).responseMessage = message;
        // Auto-strip body for HEAD requests
        if (req.method === 'HEAD') {
          return originalSend.call(res, undefined, message);
        }
        return originalSend.call(res, data, message);
      };

      const effectiveTimeout = route.timeout ?? this._timeout;

      if (effectiveTimeout > 0) {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              Object.assign(new Error('Request timed out'), {
                statusCode: 503,
              }),
            );
          }, effectiveTimeout);
        });

        try {
          await Promise.race([
            this.engine.run(req, res, route.handler),
            timeoutPromise,
          ]);
        } finally {
          // Clear the timeout to prevent severe memory leaks!
          clearTimeout(timeoutId!);
        }
      } else {
        await this.engine.run(req, res, route.handler);
      }

      try {
        this.validator.validateResponse(routeId, responsePayload);
      } catch (validationErr: any) {
        // Prevent double-logging by letting the framework handle it natively
        if (process.env.NODE_ENV === 'development') {
          console.error(
            `[Axiomify] Response schema mismatch on ${routeId}:`,
            validationErr.errors ?? validationErr.message,
          );
        }
      }

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
