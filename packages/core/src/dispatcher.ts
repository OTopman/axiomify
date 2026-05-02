import type { HookManager } from './lifecycle';
import type { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
} from './types';
import type { CompiledRouteDefinition } from './internal';
import type { ValidationCompiler } from './validation';

function attachRequestSignal(req: AxiomifyRequest): {
  controller: AbortController;
  cleanup(): void;
} | null {
  const upstreamSignal = req.signal;
  if (!upstreamSignal) return null;

  const controller = new AbortController();
  const originalSignal = upstreamSignal;
  let cleanup = () => {};

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

  req.signal = controller.signal;

  return {
    controller,
    cleanup: () => {
      req.signal = originalSignal;
      cleanup();
    },
  };
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
      requestAbort?.cleanup();
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
      requestAbort?.cleanup();
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
    const validatedRes = new ValidatingResponse(
      res,
      this.validator,
      req.method,
      routeId,
    );

    const pipeline = (route as CompiledRouteDefinition)._compiledPipeline;
    for (let i = 0; i < pipeline.length; i++) {
      if (validatedRes.headersSent) break;
      await pipeline[i](req, validatedRes);
    }

    if (!validatedRes.headersSent) {
      await this.hooks.run('onPostHandler', req, validatedRes, { route, params });
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

class ValidatingResponse implements AxiomifyResponse {
  private sendCallCount = 0;
  constructor(
    private readonly inner: AxiomifyResponse,
    private readonly validator: ValidationCompiler,
    private readonly method: string,
    private readonly routeId: string,
  ) {}

  status(code: number): this {
    this.inner.status(code);
    return this;
  }
  header(key: string, value: string): this {
    this.inner.header(key, value);
    return this;
  }
  removeHeader(key: string): this {
    this.inner.removeHeader(key);
    return this;
  }
  send<T>(data: T, message?: string): void {
    if (this.sendCallCount === 0) {
      this.validator.validateResponse(this.routeId, data, this.inner.statusCode);
      (this.inner as unknown as Record<string, unknown>).payload = data;
      (this.inner as unknown as Record<string, unknown>).responseMessage = message;
    }
    this.sendCallCount++;
    if (this.method === 'HEAD') return this.inner.send(undefined, message);
    this.inner.send(data, message);
  }
  sendRaw(payload: any, contentType?: string): void {
    this.inner.sendRaw(payload, contentType);
  }
  error(err: unknown): void {
    this.inner.error(err);
  }
  stream(readable: import('stream').Readable, contentType?: string): void {
    this.inner.stream(readable, contentType);
  }
  sseInit(sseHeartbeatMs?: number): void {
    this.inner.sseInit(sseHeartbeatMs);
  }
  sseSend(data: any, event?: string): void {
    this.inner.sseSend(data, event);
  }
  get statusCode(): number {
    return this.inner.statusCode;
  }
  get raw(): unknown {
    return this.inner.raw;
  }
  get headersSent(): boolean {
    return this.inner.headersSent;
  }
}
