import { ExecutionEngine, HookHandlerMap, HookManager } from './lifecycle';
import { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  HookType,
  RouteDefinition,
  RouteGroup,
  RouteGroupOptions,
  RoutePlugin,
  RouteSchema,
  SerializerFn,
} from './types';
import { ValidationCompiler } from './validation';

export interface AxiomifyOptions {
  timeout?: number; // Default request timeout in ms. 0 = disabled. Default: 0.
  telemetry?: {
    startSpan: (
      name: string,
      attributes: Record<string, string>,
    ) => { end(): void };
  };
}

export type AppPlugin = (app: Axiomify) => void;

function joinRoutePath(prefix: string, path: string): string {
  return (prefix + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function mergePlugins(
  inherited: RoutePlugin[] | undefined,
  local: RoutePlugin[] | undefined,
): RoutePlugin[] | undefined {
  if (!inherited?.length) return local;
  if (!local?.length) return [...inherited];
  return [...inherited, ...local];
}

export class Axiomify {
  public router = new Router();
  public engine = new ExecutionEngine();
  public validator = new ValidationCompiler();

  // Use the new unified HookEngine
  public readonly hooks = new HookManager();

  private readonly _routes: RouteDefinition[] = [];
  private readonly _timeout: number;
  private readonly _telemetry?: AxiomifyOptions['telemetry'];

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this._routes;
  }

  public get timeout(): number {
    return this._timeout;
  }

  constructor(options: AxiomifyOptions = {}) {
    this._timeout = options.timeout ?? 0;
    this._telemetry = options.telemetry;

    // Auto-inject Request ID
    this.addHook('onRequest', (req, res) => {
      res.header('X-Request-Id', req.id);
    });
  }

  public use(plugin: AppPlugin): this {
    plugin(this);
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
  public serializer: SerializerFn = (
    data,
    message,
    statusCode,
    isError,
    _req,
  ) => ({
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
  public group(prefix: string, callback: (group: RouteGroup) => void): this;
  public group(
    prefix: string,
    options: RouteGroupOptions,
    callback: (group: RouteGroup) => void,
  ): this;
  public group(
    prefix: string,
    optionsOrCallback:
      | RouteGroupOptions
      | ((group: RouteGroup) => void),
    maybeCallback?: (group: RouteGroup) => void,
  ): this {
    const options =
      typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback;

    if (!callback) {
      throw new Error(
        'A route group callback is required when registering a group.',
      );
    }

    const inheritedPlugins = options.plugins ?? [];
    const groupProxy: RouteGroup = {
      route: <S extends RouteSchema>(def: RouteDefinition<S>) => {
        return this.route({
          ...def,
          path: joinRoutePath(prefix, def.path),
          plugins: mergePlugins(inheritedPlugins, def.plugins),
        });
      },
      group: ((subPrefix, subOptionsOrCallback, subMaybeCallback) => {
        const subOptions =
          typeof subOptionsOrCallback === 'function'
            ? {}
            : subOptionsOrCallback;
        const subCallback =
          typeof subOptionsOrCallback === 'function'
            ? subOptionsOrCallback
            : subMaybeCallback;

        this.group(
          joinRoutePath(prefix, subPrefix),
          {
            plugins: mergePlugins(inheritedPlugins, subOptions.plugins),
          },
          subCallback!,
        );
        return groupProxy;
      }) as RouteGroup['group'],
    };
    callback(groupProxy);
    return this;
  }

  // Health Check Method
  public healthCheck(
    path = '/health',
    checks?: Record<string, () => Promise<boolean>>,
  ): this {
    this.route({
      method: 'GET',
      path,
      handler: async (req, res) => {
        if (!checks)
          return res
            .status(200)
            .send({ status: 'ok', uptime: process.uptime() });
        const results: Record<string, boolean> = {};
        let passed = true;
        await Promise.all(
          Object.entries(checks).map(async ([name, fn]) => {
            try {
              results[name] = await fn();
              if (!results[name]) passed = false;
            } catch {
              results[name] = false;
              passed = false;
            }
          }),
        );
        return res
          .status(passed ? 200 : 503)
          .send({ status: passed ? 'ok' : 'degraded', checks: results });
      },
    });
    return this;
  }

  public async handle(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    let matched: {
      route: RouteDefinition;
      params: Record<string, string>;
    } | null = null;

    try {
      await this.hooks.run('onRequest', req, res);
      // If an onRequest hook sent the response (e.g. CORS preflight), stop here.
      // No match is known yet, so onPostHandler is skipped — its contract is
      // that `match` is always defined.
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
      matched = match;
      const { route, params } = match;

      Object.assign(req.params as any, params);
      const routeId = `${route.method}:${route.path}`;

      // This is now 100% type-safe
      await this.hooks.run('onPreHandler', req, res, match);

      // Halt if a global hook short-circuited (rate limit, auth, etc.).
      // We still fire onPostHandler so logging/metrics see the response.
      if (res.headersSent) {
        await this.hooks.run('onPostHandler', req, res, match);
        return;
      }

      const routePlugins = route.plugins ?? [];
      for (const routePlugin of routePlugins) {
        await routePlugin(req, res);
        if (res.headersSent) {
          await this.hooks.run('onPostHandler', req, res, match);
          return;
        }
      }

      this.validator.execute(routeId, req);

      let responsePayload: unknown = undefined;
      let responseSent = false;
      const originalSend = res.send;

      res.send = (data: any, message?: string) => {
        responsePayload = data;
        responseSent = true;
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

      let span: { end(): void } | undefined;
      if (this._telemetry) {
        span = this._telemetry.startSpan('http.request', {
          method: req.method,
          path: route.path,
        });
      }

      try {
        if (effectiveTimeout > 0) {
          let timeoutId: NodeJS.Timeout | undefined;
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
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }
        } else {
          await this.engine.run(req, res, route.handler);
        }
      } finally {
        if (span) span.end();
      }

      // Only validate the response schema when the handler actually sent a
      // payload. Skipping on non-send avoids comparing `undefined` to a schema
      // that never expected to run (e.g. the handler threw after our patch).
      if (responseSent) {
        try {
          this.validator.validateResponse(
            routeId,
            responsePayload,
            res.statusCode,
          );
        } catch (validationErr: any) {
          if (process.env.NODE_ENV === 'development') {
            console.error(
              `[Axiomify] Response schema mismatch on ${routeId}:`,
              validationErr.errors ?? validationErr.message,
            );
          }
        }
      }

      await this.hooks.run('onPostHandler', req, res, match);
    } catch (err: any) {
      await this.handleError(err, req, res);
    } finally {
      await this.hooks.run('onClose', req, res);
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
