import type { HookManager } from './lifecycle';
import type { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
} from './types';
import type { CompiledRouteDefinition } from './internal';
import type { ValidationCompiler } from './validation';

export class RequestDispatcher {
  constructor(
    private readonly router: Router,
    private readonly hooks: HookManager,
    private readonly validator: ValidationCompiler,
  ) {}

  public async handle(req: AxiomifyRequest, res: AxiomifyResponse) {
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
      await this.hooks.runSafe('onClose', req, res);
    }
  }

  public async handleMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ) {
    try {
      await this.hooks.run('onRequest', req, res);
      if (res.headersSent) return;
      await this.executeMatchedRoute(req, res, route, params);
    } catch (err) {
      await this.handleError(err, req, res);
    } finally {
      await this.hooks.runSafe('onClose', req, res);
    }
  }

  private async executeMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ) {
    // Inline param assignment — Object.assign has prototype-chain walk overhead.
    const reqParams = req.params as Record<string, string>;
    for (const k in params) reqParams[k] = params[k];

    // Run onPreHandler hooks directly here — not baked into the compiled
    // pipeline — so we pay zero cost when no handlers are registered.
    // The live hooks array is read at dispatch time, preserving late-registration
    // semantics without the closure allocation per route.
    const preHandlerList = this.hooks.hooks.onPreHandler;
    if (preHandlerList.length > 0) {
      await this.hooks.run('onPreHandler', req, res, {
        route,
        params: reqParams,
      });
      if (res.headersSent) return;
    }

    const compiled = route as CompiledRouteDefinition;
    const routeId = `${route.method}:${route.path}`;

    // Wrap in ValidatingResponse when:
    //  (a) the route has a response schema — validate the outgoing payload, OR
    //  (b) the HTTP method is HEAD — strip the response body (HEAD must have
    //      identical headers to GET but zero entity body, per RFC 9110 §9.3.2).
    //
    // For schema-less non-HEAD requests we skip the wrapper entirely, saving
    // one object allocation and one extra property-access chain per request.
    const needsWrapper = compiled._hasResponseSchema || req.method === 'HEAD';
    const dispatchRes: AxiomifyResponse = needsWrapper
      ? new ValidatingResponse(res, this.validator, req.method, routeId)
      : res;

    const pipeline = compiled._compiledPipeline;
    for (let i = 0; i < pipeline.length; i++) {
      if (dispatchRes.headersSent) break;
      await pipeline[i](req, dispatchRes);
    }

    await this.hooks.run('onPostHandler', req, dispatchRes, { route, params });
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

/**
 * Wraps a response to perform response-schema validation on the first `send()`
 * call, and to handle HEAD-method body suppression.
 * Only instantiated when the route has a `schema.response` defined.
 */
class ValidatingResponse implements AxiomifyResponse {
  private _sent = false;
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
  getHeader(key: string): string | undefined {
    return this.inner.getHeader(key);
  }
  removeHeader(key: string): this {
    this.inner.removeHeader(key);
    return this;
  }
  send<T>(data: T, message?: string): void {
    if (!this._sent) {
      this._sent = true;
      this.validator.validateResponse(
        this.routeId,
        data,
        this.inner.statusCode,
      );
      (this.inner as unknown as Record<string, unknown>).payload = data;
      (this.inner as unknown as Record<string, unknown>).responseMessage =
        message;
    }
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
  get capabilities() {
    return this.inner.capabilities ?? { sse: false, streaming: false };
  }
  sseInit(sseHeartbeatMs?: number): void {
    this.inner.sseInit?.(sseHeartbeatMs);
  }
  sseSend(data: any, event?: string): void {
    this.inner.sseSend?.(data, event);
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
