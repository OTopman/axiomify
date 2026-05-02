import type { HookManager } from './lifecycle';
import type { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
} from './types';
import type { ValidationCompiler } from './validation';

function attachRequestSignal(req: AxiomifyRequest): {
  controller: AbortController;
  cleanup(): void;
} {
  const controller = new AbortController();
  const upstreamSignal = req.signal;
  let cleanup = () => {};

  if (upstreamSignal) {
    const abortFromUpstream = () => {
      if (!controller.signal.aborted) controller.abort(upstreamSignal.reason);
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

export class RequestDispatcher {
  constructor(
    private readonly router: Router,
    private readonly hooks: HookManager,
    private readonly validator: ValidationCompiler,
  ) {}

  public async handle(req: AxiomifyRequest, res: AxiomifyResponse) {
    const requestAbort = attachRequestSignal(req);
    try {
      await this.hooks.run('onRequest', req, res);
      if (res.headersSent) return;

      const match = this.router.lookup(req.method, req.path);
      if (!match) return res.status(404).send(null, 'Route not found');
      if ('error' in match) {
        res.header('Allow', match.allowed.join(', '));
        return res.status(405).send(null, 'Method Not Allowed');
      }

      await this.executeMatchedRoute(req, res, match.route, match.params);
    } catch (err) {
      await this.handleError(err, req, res);
    } finally {
      requestAbort.cleanup();
      await this.hooks.runSafe('onClose', req, res);
    }
  }

  public async handleMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ) {
    const requestAbort = attachRequestSignal(req);
    try {
      await this.hooks.run('onRequest', req, res);
      if (res.headersSent) return;
      await this.executeMatchedRoute(req, res, route, params);
    } catch (err) {
      await this.handleError(err, req, res);
    } finally {
      requestAbort.cleanup();
      await this.hooks.runSafe('onClose', req, res);
    }
  }

  private async executeMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ) {
    Object.assign(req.params as object, params);
    const routeId = `${route.method}:${route.path}`;
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

    const pipeline = route._compiledPipeline!;
    for (let i = 0; i < pipeline.length; i++) {
      if (res.headersSent) break;
      await pipeline[i](req, res);
    }

    if (!res.headersSent) {
      await this.hooks.run('onPostHandler', req, res, { route, params });
    }
  }

  private async handleError(
    err: unknown,
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) {
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
