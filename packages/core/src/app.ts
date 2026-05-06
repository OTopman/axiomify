import { RequestDispatcher } from './dispatcher';
import { HookHandlerMap, HookManager } from './lifecycle';
import { RouteRegistry } from './registry';
import { makeSerialize } from './serialize';
import type {
  AppConfigurator,
  AppContext,
  AppModule,
  AppPlugin,
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

export type { AppConfigurator, AppContext, AppModule, AppPlugin };

export interface AxiomifyOptions {
  timeout?: number;
  telemetry?: {
    startSpan: (name: string, attributes: Record<string, string>) => { end(): void };
  };
}

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
  private _routesLocked = false;
  private _routesLockedReason?: string;

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
    // No default hooks registered here.
    // The X-Request-Id hook previously baked in here was registering
    // a closure on every request for every app — including apps that never
    // needed request tracing. It is now opt-in via app.enableRequestId().
  }

  /**
   * Opts in to automatic X-Request-Id header injection.
   *
   * Uses a per-process counter (much faster than crypto.randomUUID) and
   * respects upstream `x-request-id` headers when present.
   *
   * Previously this was baked unconditionally into the Axiomify constructor,
   * meaning every application paid the cost regardless of need. It is now
   * explicitly opt-in.
   *
   * @example
   * const app = new Axiomify();
   * app.enableRequestId();
   */
  public enableRequestId(): this {
    let counter = 0;
    const pid = process.pid.toString(36);
    this.addHook('onRequest', (req, res) => {
      const upstream = (req.headers as Record<string, string | undefined>)?.['x-request-id'];
      res.header('X-Request-Id', upstream ?? `${pid}-${(++counter).toString(36)}`);
    });
    return this;
  }

  /**
   * Register a plugin (configurator function or module) with the application.
   *
   * Accepted forms:
   *   - AppConfigurator: (app, context) => void — preferred
   *   - AppModule: named object with register() + optional dependencies[]
   *   - AppPlugin: (app) => void — @deprecated, use AppConfigurator
   */
  public use(configurator: AppPlugin | AppConfigurator | AppModule): this {
    const context: AppContext = {
      provide: (token, value) => this._services.set(token, value),
      resolve: (token) => this._services.get(token) as never,
    };

    if (typeof configurator === 'function') {
      // Both AppPlugin and AppConfigurator are called the same way.
      // AppPlugin ignores the second argument; AppConfigurator uses it.
      // The previous arity-check approach is removed — it misidentified
      // intentional 1-arg arrow functions as the deprecated form.
      (configurator as AppConfigurator)(this, context);
      return this;
    }

    if (this._modules.has(configurator.name)) return this;

    // Topological resolution: collect the transitive closure of all modules
    // that need to be registered before `configurator`, in dependency order,
    // using Kahn's algorithm. This replaces the old order-assertion stub which
    // required callers to register modules in the correct order manually and
    // gave no help when cycles existed.
    const ordered = this._resolveModuleDeps(configurator);
    for (const mod of ordered) {
      if (this._modules.has(mod.name)) continue;
      mod.register(this, context);
      this._modules.add(mod.name);
    }
    return this;
  }


  /**
   * Kahn's algorithm: produce a topologically-ordered list of AppModule
   * instances (including root) that must be registered, respecting all declared
   * dependency edges, with full cycle detection.
   *
   * Replaces the previous order-assertion stub which:
   *  - Required callers to register modules in the correct order manually.
   *  - Gave no useful error when a cycle existed (just "register X before Y").
   *  - Could not auto-resolve transitive dependencies.
   *
   * Now: pass modules in any order — the framework resolves them.
   * Cycles produce a clear error naming the offending module names.
   */
  private _resolveModuleDeps(root: AppModule): AppModule[] {
    // BFS: collect all reachable AppModule objects (we only have objects the
    // caller passed; already-registered deps are skipped at execution time).
    const byName = new Map<string, AppModule>();
    const visit: AppModule[] = [root];
    while (visit.length) {
      const mod = visit.shift()!;
      if (byName.has(mod.name)) continue;
      byName.set(mod.name, mod);
      for (const dep of mod.dependencies ?? []) {
        if (byName.has(dep) || this._modules.has(dep)) continue;
        throw new Error(
          `[Axiomify] Module "${mod.name}" declares dependency "${dep}", ` +
          `but no module with that name has been passed to app.use(). ` +
          `Pass the "${dep}" module to app.use() before or alongside "${mod.name}".`,
        );
      }
    }

    // Build in-degree + adjacency map (dep → dependents) over collected nodes.
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const name of byName.keys()) { inDegree.set(name, 0); adj.set(name, []); }
    for (const [name, mod] of byName) {
      for (const dep of mod.dependencies ?? []) {
        if (!byName.has(dep)) continue; // already-registered — skip edge
        adj.get(dep)!.push(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }

    // Kahn's: start with zero-in-degree nodes.
    const ready: string[] = [];
    for (const [name, deg] of inDegree) { if (deg === 0) ready.push(name); }

    const ordered: AppModule[] = [];
    while (ready.length) {
      const name = ready.shift()!;
      ordered.push(byName.get(name)!);
      for (const dep of adj.get(name) ?? []) {
        const d = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, d);
        if (d === 0) ready.push(dep);
      }
    }

    // If not all nodes processed, a cycle exists.
    if (ordered.length !== byName.size) {
      const cycle = [...byName.keys()].filter((n) => (inDegree.get(n) ?? 0) > 0);
      throw new Error(
        `[Axiomify] Circular dependency detected among modules: [${cycle.join(', ')}]. ` +
        `Break the cycle by extracting shared logic into a dependency-free module.`,
      );
    }
    return ordered;
  }

  public addHook<T extends HookType>(type: T, handler: HookHandlerMap[T]): this {
    this.hooks.add(type, handler);
    return this;
  }

  public route<S extends RouteSchema>(definition: RouteDefinition<S>): this {
    if (this._routesLocked) {
      const reason = this._routesLockedReason ? ` (${this._routesLockedReason})` : '';
      throw new Error(
        `Cannot register route ${definition.method} ${definition.path} after adapter binding${reason}. ` +
          'Register all routes before creating an adapter.',
      );
    }
    this.registry.register(definition);
    return this;
  }

  /**
   * Locks route registration once an adapter has bound transport routes.
   * Prevents silent route drift where late-registered routes never get
   * mounted by adapters that snapshot routes at construction time.
   *
   * @internal Called by adapters only. Not part of the public Axiomify API.
   * Direct user calls will throw confusing errors at registration time.
   */
  public lockRoutes(reason?: string): this {
    this._routesLocked = true;
    this._routesLockedReason = reason;
    return this;
  }

  /** Default response serializer. Replace via app.setSerializer(). */
  public serializer: SerializerFn = ({ data, message, statusCode, isError }: SerializerInput) => ({
    status: isError || (statusCode && statusCode >= 400) ? 'failed' : 'success',
    message:
      message || (isError || (statusCode && statusCode >= 400) ? 'Error' : 'Operation successful'),
    data,
  });

  public setSerializer(fn: SerializerFn): this {
    // Normalise to the single-argument form once, so every subsequent call
    // to this.serializer goes through a direct (input) => fn(input) path
    // with no runtime arity check. makeSerialize is shared with adapters.
    this.serializer = makeSerialize(fn) as SerializerFn;
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
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;

    if (!callback) throw new Error('A route group callback is required.');

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
          typeof subOptionsOrCallback === 'function' ? {} : subOptionsOrCallback;
        const subCallback =
          typeof subOptionsOrCallback === 'function' ? subOptionsOrCallback : subMaybeCallback;

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
          return res.status(200).send({ status: 'ok', uptime: process.uptime() });
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

  public async handle(req: AxiomifyRequest, res: AxiomifyResponse): Promise<void> {
    return this.dispatcher.handle(req, res);
  }

  /**
   * Adapter entry point for pre-routed requests.
   *
   * @internal Called by adapters only. Not part of the public Axiomify API.
   */
  public async handleMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ): Promise<void> {
    return this.dispatcher.handleMatchedRoute(req, res, route, params);
  }
}
