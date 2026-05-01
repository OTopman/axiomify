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

function attachRequestSignal(req: AxiomifyRequest): {
  controller: AbortController;
  cleanup(): void;
} {
  const controller = new AbortController();
  const upstreamSignal = req.signal;
  let cleanup = () => {};

  if (upstreamSignal) {
    const abortFromUpstream = () => {
      if (!controller.signal.aborted) {
        controller.abort(upstreamSignal.reason);
      }
    };

    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, {
        once: true,
      });
      cleanup = () =>
        upstreamSignal.removeEventListener('abort', abortFromUpstream);
    }
  }

  Object.defineProperty(req, 'signal', {
    value: controller.signal,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  return { controller, cleanup };
}

export class Axiomify {
  public readonly router = new Router();
  public readonly validator = new ValidationCompiler();
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
            statusCode: 503,
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
    const requestAbort = attachRequestSignal(req);
    let match: ReturnType<typeof this.router.lookup> = null;

    try {
      await this.hooks.run('onRequest', req, res);
      if (res.headersSent) return;

      match = this.router.lookup(req.method, req.path);
      if (!match) return res.status(404).send(null, 'Route not found');
      if ('error' in match) {
        res.header('Allow', match.allowed.join(', '));
        return res.status(405).send(null, 'Method Not Allowed');
      }

      Object.assign(req.params as object, match.params);
      const routeId = `${match.route.method}:${match.route.path}`;

      // NOTE: This res.send monkey-patch allocates closures per request.
      // It is necessary for the current Express/Fastify adapters, but we will
      // bypass this entirely in the uWS native adapter.
      let sendCallCount = 0;
      const originalSend = res.send.bind(res);
      res.send = (data: unknown, message?: string) => {
        if (sendCallCount === 0) {
          this.validator.validateResponse(routeId, data, res.statusCode);
          (res as unknown as Record<string, unknown>).payload = data;
          (res as unknown as Record<string, unknown>).responseMessage = message;
        }
        sendCallCount++;
        if (req.method === 'HEAD') return originalSend(undefined, message);
        return originalSend(data, message);
      };

      // --- THE BLAZING FAST EXECUTION LOOP ---
      // Zero dynamic logic. Just iterate and execute.
      const pipeline = match.route._compiledPipeline!;
      for (let i = 0; i < pipeline.length; i++) {
        if (res.headersSent) break;
        await pipeline[i](req, res);
      }

      if (!res.headersSent) {
        await this.hooks.run('onPostHandler', req, res, match);
      }
    } catch (err: unknown) {
      await this.handleError(err, req, res);
    } finally {
      requestAbort.cleanup();
      await this.hooks.runSafe('onClose', req, res);
    }
  }

  private async handleError(
    err: unknown,
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) {
    // runSafe: a throwing onError hook must not re-enter handleError and
    // recurse until the call stack overflows.
    await this.hooks.runSafe('onError', err, req, res);
    if (res.headersSent) return;

    const anyErr = err as Record<string, unknown>;
    const statusCode =
      typeof anyErr.statusCode === 'number'
        ? anyErr.statusCode
        : typeof anyErr.status === 'number'
        ? anyErr.status
        : 500;
    const message =
      typeof anyErr.message === 'string'
        ? anyErr.message
        : 'Internal Server Error';

    const errorData =
      anyErr.issues ??
      anyErr.errors ??
      (process.env.NODE_ENV === 'development'
        ? { stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined }
        : null);

    res.status(statusCode).send(errorData, message);
  }
}
