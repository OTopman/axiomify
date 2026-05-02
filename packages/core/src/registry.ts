import type { HookManager } from './lifecycle';
import { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
  RouteSchema,
} from './types';
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

    pipeline.push(async (req, res) => {
      await this.hooks.run('onPreHandler', req, res, {
        route: definition as RouteDefinition,
        params: req.params as Record<string, string>,
      });
    });

    if (definition.plugins) pipeline.push(...definition.plugins);

    if (definition.schema) {
      pipeline.push((req) => this.validator.execute(routeId, req));
    }

    const effectiveTimeout = definition.timeout ?? this.options.timeout;
    pipeline.push(async (req, res) => {
      let span: { end(): void } | undefined;
      if (this.options.telemetry) {
        span = this.options.telemetry.startSpan('http.request', {
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
            timeoutId = setTimeout(() => reject(timeoutError), effectiveTimeout);
          });
          try {
            await Promise.race([definition.handler(req as never, res), timeoutPromise]);
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

    definition._compiledPipeline = pipeline;
    this.router.register(definition as RouteDefinition);
    this.routes.push(definition as RouteDefinition);
  }
}
