import { RequestDispatcher } from './dispatcher';
import { HookHandlerMap, HookManager } from './lifecycle';
import { RouteRegistry } from './registry';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  HookType,
  RouteDefinition,
  RouteGroup,
  RouteGroupOptions,
  RouteMiddleware,
  RouteSchema,
  SerializerFn,
  SerializerInput,
} from './types';

export interface AxiomifyOptions {
  timeout?: number;
  telemetry?: {
    startSpan: (
      name: string,
      attributes: Record<string, string>,
    ) => { end(): void };
  };
}

export interface AppContext {
  provide<T>(token: string, value: T): void;
  resolve<T>(token: string): T | undefined;
}

export interface AppModule {
  name: string;
  dependencies?: string[];
  register(app: Axiomify, context: AppContext): void;
}

export type AppConfigurator = (app: Axiomify, context: AppContext) => void;
/** @deprecated Use AppConfigurator or AppModule instead. */
export type AppPlugin = (app: Axiomify) => void;

function joinRoutePath(prefix: string, path: string): string {
  return (prefix + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function mergePlugins(
  inherited: RouteMiddleware[] | undefined,
  local: RouteMiddleware[] | undefined,
): RouteMiddleware[] | undefined {
  if (!inherited?.length) return local;
  if (!local?.length) return [...inherited];
  return [...inherited, ...local];
}

export class Axiomify {
  public readonly hooks = new HookManager();
  private readonly registry: RouteRegistry;
  private readonly dispatcher: RequestDispatcher;
  private readonly _timeout: number;
  private readonly _telemetry?: AxiomifyOptions['telemetry'];
  private readonly _services = new Map<string, unknown>();
  private readonly _modules = new Set<string>();

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this.registry.registeredRoutes;
  }

  public get router() {
    return this.registry.router;
  }

  public get validator() {
    return this.registry.validator;
  }

  public get timeout(): number {
    return this._timeout;
  }

  constructor(options: AxiomifyOptions = {}) {
    this._timeout = options.timeout ?? 0;
    this._telemetry = options.telemetry;
    this.registry = new RouteRegistry(this.hooks, {
      timeout: this._timeout,
      telemetry: this._telemetry,
    });
    this.dispatcher = new RequestDispatcher(
      this.registry.router,
      this.hooks,
      this.registry.validator,
    );

    this.addHook('onRequest', (req, res) => {
      res.header('X-Request-Id', req.id);
    });
  }

  public use(configurator: AppPlugin | AppConfigurator | AppModule): this {
    const context: AppContext = {
      provide: (token, value) => this._services.set(token, value),
      resolve: (token) => this._services.get(token) as never,
    };
    if (typeof configurator === 'function') {
      if (configurator.length >= 2) {
        (configurator as AppConfigurator)(this, context);
      } else {
        (configurator as AppPlugin)(this);
      }
      return this;
    }

    if (this._modules.has(configurator.name)) return this;
    for (const dep of configurator.dependencies ?? []) {
      if (!this._modules.has(dep)) {
        throw new Error(
          `Module "${configurator.name}" requires "${dep}" to be registered first.`,
        );
      }
    }
    configurator.register(this, context);
    this._modules.add(configurator.name);
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
    this.registry.register(definition);
    return this;
  }

  private invokeSerializer(fn: SerializerFn, input: SerializerInput): any {
    return fn.length <= 1
      ? (fn as (input: SerializerInput) => any)(input)
      : (fn as any)(
          input.data,
          input.message,
          input.statusCode,
          input.isError,
          input.req,
        );
  }

  public serializer: SerializerFn = (
    { data, message, statusCode, isError },
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
    this.serializer = (input) => this.invokeSerializer(fn, input);
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

