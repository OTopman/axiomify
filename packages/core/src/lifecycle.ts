import type { AxiomifyRequest, AxiomifyResponse, RouteHandler } from './types';
export type HookType = 'onRequest' | 'preHandler' | 'onPostHandler' | 'onError';

export class HookManager {
  private hooks: Record<HookType, Function[]> = {
    onRequest: [],
    preHandler: [],
    onPostHandler: [],
    onError: [],
  };

  add(type: HookType, fn: Function) {
    this.hooks[type].push(fn);
  }

  public run(type: HookType, ...args: any[]): Promise<void> | void {
    const hooksToRun = this.hooks[type];

    // 🚀 THE SHORT-CIRCUIT: Return synchronously if empty!
    // This saves massive V8 Event Loop overhead.
    if (!hooksToRun || hooksToRun.length === 0) {
      return;
    }

    // Only enter the microtask queue if we actually have work to do
    return this.executeHooks(hooksToRun, args);
  }

  private async executeHooks(hooks: Function[], args: any[]) {
    for (const hook of hooks) {
      await hook(...args);
    }
  }
}

export type LifecycleHook = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => Promise<void> | void;
export type ErrorHook = (
  error: unknown,
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => Promise<void> | void;

export interface PluginHooks {
  onRequest: LifecycleHook[];
  onPreHandler: LifecycleHook[];
  onPostHandler: LifecycleHook[];
  onError: ErrorHook[];
}

export class ExecutionEngine {
  private globalHooks: PluginHooks = {
    onRequest: [],
    onPreHandler: [],
    onPostHandler: [],
    onError: [],
  };

  /**
   * Registers a global plugin/middleware hook
   */
  public addHook(
    lifecycle: keyof PluginHooks,
    handler: LifecycleHook | ErrorHook,
  ): void {
    if (lifecycle === 'onError') {
      this.globalHooks.onError.push(handler as ErrorHook);
    } else {
      this.globalHooks[lifecycle].push(handler as LifecycleHook);
    }
  }

  /**
   * The Core Request Runner.
   * This is the heart of the framework where every request flows.
   */
  public async run(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    handler: RouteHandler,
    routeHooks?: Partial<PluginHooks>,
  ): Promise<void> {
    // 1. onRequest (Global -> Route)
    await this.executeHooks(this.globalHooks.onRequest, req, res);
    if (routeHooks?.onRequest)
      await this.executeHooks(routeHooks.onRequest, req, res);

    // 2. Validation (To be implemented in the next step)
    // await this.validateRequest(req, routeSchema);

    // 3. onPreHandler (Global -> Route)
    await this.executeHooks(this.globalHooks.onPreHandler, req, res);
    if (routeHooks?.onPreHandler)
      await this.executeHooks(routeHooks.onPreHandler, req, res);

    // 4. Main Route Handler
    await handler(req, res);

    // 5. onPostHandler (Global -> Route)
    await this.executeHooks(this.globalHooks.onPostHandler, req, res);
    if (routeHooks?.onPostHandler)
      await this.executeHooks(routeHooks.onPostHandler, req, res);
  }

  /**
   * Sequentially executes an array of hooks.
   * A flat 'for' loop is used for maximum performance and a flat stack trace.
   */
  private async executeHooks(
    hooks: LifecycleHook[],
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    for (let i = 0; i < hooks.length; i++) {
      await hooks[i](req, res);
    }
  }

  /**
   * Normalizes errors into our StandardResponse format.
   */
  private async handleError(
    err: unknown,
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    // Run custom error hooks first (e.g., Sentry logging, metrics)
    for (const hook of this.globalHooks.onError) {
      await hook(err, req, res);
    }

    // Default error normalization if the response hasn't been sent
    const message =
      err instanceof Error ? err.message : 'Internal Server Error';
    res.status(500).send({
      status: 'failed',
      message: message,
      data: null,
    });
  }
}
