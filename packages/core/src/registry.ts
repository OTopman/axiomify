import { compiledStates } from './compiled';
import { defaultLogger, type AxiomifyLogger } from './internal';
import type { HookManager } from './lifecycle';
import { Router } from './router';

import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
  RouteSchema,
  WsRouteDefinition,
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
  logger?: AxiomifyLogger;
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
  public readonly validator: ValidationCompiler;
  private readonly routes: RouteDefinition[] = [];
  private readonly wsRoutes: WsRouteDefinition<any, any>[] = [];

  constructor(
    private readonly hooks: HookManager,
    private readonly options: RegistryOptions,
  ) {
    this.validator = new ValidationCompiler(options.logger ?? defaultLogger);
  }

  public get registeredRoutes(): readonly RouteDefinition[] {
    return this.routes;
  }

  public get registeredWsRoutes(): readonly WsRouteDefinition<any, any>[] {
    return this.wsRoutes;
  }

  public register<S extends RouteSchema>(definition: RouteDefinition<S>): void {
    const routeId = `${definition.method}:${definition.path}`;
    if (definition.schema) this.validator.compile(routeId, definition.schema);

    const pipeline: Array<
      (req: AxiomifyRequest, res: AxiomifyResponse) => Promise<void> | void
    > = [];

    // onPreHandler hooks are NOT baked into the per-route pipeline.
    // The dispatcher runs them directly before entering the pipeline so that:
    //   (a) we pay zero cost when no onPreHandler hooks are registered, and
    //   (b) hooks added after route registration still execute — the dispatcher
    //       reads the live hooks list at dispatch time, not at compile time.

    if (definition.plugins) pipeline.push(...definition.plugins);
    if (definition.schema) {
      pipeline.push((req) => this.validator.execute(routeId, req));
    }

    const effectiveTimeout = definition.timeout ?? this.options.timeout;
    const hasTelemetry = !!this.options.telemetry;

    if (effectiveTimeout > 0 || hasTelemetry) {
      // Full path: supports timeout and/or tracing.
      const telemetry = this.options.telemetry;
      pipeline.push(async (req, res) => {
        const timeoutError = createTimeoutError();
        const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
        let span: { end(): void } | undefined;
        if (telemetry) {
          span = telemetry.startSpan('http.request', {
            method: req.method,
            path: definition.path,
          });
        }
        try {
          await Promise.race([
            definition.handler(req as never, res),
            rejectOnAbort(timeoutSignal, timeoutError),
          ]);
        } finally {
          span?.end();
        }
      });
    } else {
      // Fast path: no timeout, no telemetry — call handler directly.
      const handler = definition.handler;
      pipeline.push((req, res) => handler(req as never, res));
    }

    // Store compiled state in a WeakMap — never mutate the caller's object.
    compiledStates.set(definition as RouteDefinition, {
      pipeline,
      hasResponseSchema: !!definition.schema?.response,
    });

    this.router.register(definition as RouteDefinition);
    this.routes.push(definition as RouteDefinition);
  }

  public registerWs<S extends RouteSchema, M = any>(
    definition: WsRouteDefinition<S, M>,
  ): void {
    const routeId = `WS:${definition.path}`;
    if (definition.schema?.message) {
      // The ValidationCompiler is a request-shape validator (body / query /
      // params / response). WS messages don't fit that shape directly, so
      // we project the message schema into the `body` slot and reuse the
      // same compiled-AJV pipeline. The shape below is a valid RouteSchema
      // structurally — explicit object construction (not a spread + cast)
      // so TypeScript can verify it without a cast escape hatch.
      const messageSchema: RouteSchema = {
        body: definition.schema.message,
        query: definition.schema.query,
        params: definition.schema.params,
        response: definition.schema.response,
        files: definition.schema.files,
      };
      this.validator.compile(routeId + ':message', messageSchema);
    }
    this.wsRoutes.push(definition);
  }
}
