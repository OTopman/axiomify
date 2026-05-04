import type { HookManager } from './lifecycle';
import { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
  RouteSchema,
} from './types';
import type { CompiledRouteDefinition } from './internal';
import { ValidationCompiler } from './validation';

interface RegistryOptions {
  timeout: number;
  telemetry?: {
    startSpan: (
      name: string,
      attributes: Record<string, string>,
    ) => { end(): void };
  };
}

function createTimeoutError(): Error & { statusCode: number } {
  return Object.assign(new Error('Request timed out'), { statusCode: 408 });
}

function rejectOnAbort(
  signal: AbortSignal,
  error: Error & { statusCode: number },
): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(error);
    signal.addEventListener('abort', () => reject(error), { once: true });
  });
}

export class RouteRegistry {
  public readonly router = new Router();
  public readonly validator = new ValidationCompiler();
  private readonly routes: RouteDefinition[] = [];

  constructor(
    private readonly hooks: HookManager,
    private readonly options: RegistryOptions,
  ) {}

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this.routes;
  }

  public register<S extends RouteSchema>(definition: RouteDefinition<S>): void {
    const routeId = `${definition.method}:${definition.path}`;
    if (definition.schema) this.validator.compile(routeId, definition.schema);

    const pipeline: Array<
      (req: AxiomifyRequest, res: AxiomifyResponse) => Promise<void> | void
    > = [];

    // Always include the onPreHandler stage so hooks added after route
    // registration still execute deterministically for all routes.
    const hookRef = this.hooks;
    const defRef = definition as RouteDefinition;
    pipeline.push((req, res) =>
      hookRef.run('onPreHandler', req, res, {
        route: defRef,
        params: req.params as Record<string, string>,
      }),
    );

    if (definition.plugins) pipeline.push(...definition.plugins);

    if (definition.schema) {
      pipeline.push((req) => this.validator.execute(routeId, req));
    }

    const effectiveTimeout = definition.timeout ?? this.options.timeout;
    const hasTelemetry = !!this.options.telemetry;

    if (effectiveTimeout > 0 || hasTelemetry) {
      // Full path: supports timeout and/or tracing.
      const timeoutError = createTimeoutError();
      const telemetry = this.options.telemetry;
      pipeline.push(async (req, res) => {
        let span: { end(): void } | undefined;
        if (telemetry) {
          span = telemetry.startSpan('http.request', {
            method: req.method,
            path: definition.path,
          });
        }
        try {
          if (effectiveTimeout > 0) {
            const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
            await Promise.race([
              definition.handler(req as never, res),
              rejectOnAbort(timeoutSignal, timeoutError),
            ]);
          } else {
            await definition.handler(req as never, res);
          }
        } finally {
          if (span) span.end();
        }
      });
    } else {
      // Fast path: no timeout, no telemetry — call handler directly.
      // Avoids one async wrapper and reduces microtask pressure.
      const handler = definition.handler;
      pipeline.push((req, res) => handler(req as never, res));
    }

    (definition as CompiledRouteDefinition)._compiledPipeline = pipeline;
    this.router.register(definition as RouteDefinition);
    this.routes.push(definition as RouteDefinition);
  }
}
