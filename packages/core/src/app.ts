import { RequestDispatcher } from './dispatcher';
import { HookHandlerMap, HookManager } from './lifecycle';
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
  timeout?: number;
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
  public readonly router = new Router();
  public readonly validator = new ValidationCompiler();
  public readonly hooks = new HookManager();
  private readonly dispatcher = new RequestDispatcher(
    this.router,
    this.hooks,
    this.validator,
  );

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
    const routeId = `${definition.method}:${definition.path}`;

    if (definition.schema) {
      this.validator.compile(routeId, definition.schema);
    }

    // --- PRE-COMPILE THE PIPELINE ---
    const pipeline: Array<
      (req: AxiomifyRequest, res: AxiomifyResponse) => Promise<void> | void
    > = [];

    // We wrap this so we don't have to dynamically look up the hook array per request.
    pipeline.push(async (req, res) => {
      await this.hooks.run('onPreHandler', req, res, {
        route: definition as RouteDefinition,
        params: req.params as Record<string, string>,
      });
    });

    // Route-specific Plugins
    if (definition.plugins) {
      pipeline.push(...definition.plugins);
    }

    // Zod Validation
    if (definition.schema) {
      pipeline.push((req) => {
        this.validator.execute(routeId, req);
      });
    }

    // The Core Handler
    // Telemetry and timeout logic is moved here so it only wraps the final handler, not the whole pipeline.
    const effectiveTimeout = definition.timeout ?? this._timeout;
    pipeline.push(async (req, res) => {
      let span: { end(): void } | undefined;
      if (this._telemetry) {
        span = this._telemetry.startSpan('http.request', {
          method: req.method,
          path: definition.path,
        });
      }

      try {
        if (effectiveTimeout > 0) {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeoutError = Object.assign(new Error('Request timed out'), {
            statusCode: 408,
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(timeoutError),
              effectiveTimeout,
            );
          });

          try {
            await Promise.race([
              definition.handler(req as never, res),
              timeoutPromise,
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }
        } else {
          await definition.handler(req as never, res);
        }
      } finally {
        if (span) span.end();
      }
    });

    // Lock it in
    definition._compiledPipeline = pipeline;

    this.router.register(definition as RouteDefinition);
    this._routes.push(definition as RouteDefinition);

    return this;
  }

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

  public group(prefix: string, callback: (group: RouteGroup) => void): this;
  public group(
    prefix: string,
    options: RouteGroupOptions,
    callback: (group: RouteGroup) => void,
  ): this;
  public group(
    prefix: string,
    optionsOrCallback: RouteGroupOptions | ((group: RouteGroup) => void),
    maybeCallback?: (group: RouteGroup) => void,
  ): this {
    const options =
      typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback;

    if (!callback) {
      throw new Error('A route group callback is required.');
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
          { plugins: mergePlugins(inheritedPlugins, subOptions.plugins) },
          subCallback!,
        );
        return groupProxy;
      }) as RouteGroup['group'],
    };
    callback(groupProxy);
    return this;
  }

  public healthCheck(
    path = '/health',
    checks?: Record<string, () => Promise<boolean>>,
  ): this {
    this.route({
      method: 'GET',
      path,
      handler: async (_req, res) => {
        if (!checks) {
          // Include uptime so callers can introspect process health duration.
          return res
            .status(200)
            .send({ status: 'ok', uptime: process.uptime() });
        }

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
    return this.dispatcher.handle(req, res);
  }

  public async handleMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ): Promise<void> {
    return this.dispatcher.handleMatchedRoute(req, res, route, params);
  }
}

