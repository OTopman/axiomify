import { getCompiledState } from './compiled';
import type { HookManager } from './lifecycle';
import type { Router } from './router';
import type { AxiomifyRequest, AxiomifyResponse, RouteDefinition } from './types';
import type { ValidationCompiler } from './validation';

export class RequestDispatcher {
  constructor(
    private readonly router: Router,
    private readonly hooks: HookManager,
    private readonly validator: ValidationCompiler,
  ) {}

  public async handle(req: AxiomifyRequest, res: AxiomifyResponse): Promise<void> {
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

  /**
   * Entry point for adapters that perform their own routing (uWS, Fastify, etc.)
   * and hand off a pre-resolved route + params to the dispatcher.
   *
   * @internal — adapter use only. Not part of the public Axiomify API.
   */
  public async handleMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ): Promise<void> {
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
  ): Promise<void> {
    // Inline param assignment into the mutable params bag on the request.
    // Object.assign performs a prototype-chain walk; direct property write is faster.
    const reqParams = req.params as Record<string, string>;
    for (const k in params) reqParams[k] = params[k];

    // Run onPreHandler hooks at dispatch time (not baked into the compiled
    // pipeline) so late-registered hooks still execute and we pay zero cost
    // when no onPreHandler hooks are registered.
    const preHandlerList = this.hooks.hooks.onPreHandler;
    if (preHandlerList.length > 0) {
      await this.hooks.run('onPreHandler', req, res, { route, params: reqParams });
      if (res.headersSent) return;
    }

    const { pipeline, hasResponseSchema } = getCompiledState(route);
    const routeId = `${route.method}:${route.path}`;

    // Instantiate ValidatingResponse only when the route has a response schema,
    // or when HEAD must suppress the body (RFC 9110 §9.3.2).
    // For the common case — schema-less non-HEAD requests — we skip the wrapper
    // entirely, saving one object allocation and one delegation chain per request.
    const needsWrapper = hasResponseSchema || req.method === 'HEAD';
    const dispatchRes: AxiomifyResponse = needsWrapper
      ? new ValidatingResponse(res, this.validator, req.method, routeId)
      : res;

    // Unroll single-step pipeline: avoid loop + conditional overhead for the
    // common case of no plugins + no schema (just the handler).
    if (pipeline.length === 1) {
      await pipeline[0](req, dispatchRes);
    } else {
      for (let i = 0; i < pipeline.length; i++) {
        if (dispatchRes.headersSent) break;
        await pipeline[i](req, dispatchRes);
      }
    }

    await this.hooks.run('onPostHandler', req, dispatchRes, { route, params });
  }

  private async handleError(err: unknown, req: AxiomifyRequest, res: AxiomifyResponse): Promise<void> {
    await this.hooks.runSafe('onError', err, req, res);
    if (res.headersSent) return;
    const anyErr = err as Record<string, unknown>;
    const statusCode =
      typeof anyErr.statusCode === 'number' ? anyErr.statusCode
      : typeof anyErr.status === 'number' ? anyErr.status
      : 500;
    const message = typeof anyErr.message === 'string' ? anyErr.message : 'Internal Server Error';
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
 * Wraps a response to perform response-schema validation on the first send()
 * call, and to handle HEAD-method body suppression.
 *
 * Only instantiated when the route has a schema.response defined.
 * For all other routes the dispatcher uses the inner response directly.
 */
class ValidatingResponse implements AxiomifyResponse {
  private _sent = false;
  constructor(
    private readonly inner: AxiomifyResponse,
    private readonly validator: ValidationCompiler,
    private readonly method: string,
    private readonly routeId: string,
  ) {}

  status(code: number): this { this.inner.status(code); return this; }
  header(key: string, value: string): this { this.inner.header(key, value); return this; }
  getHeader(key: string): string | undefined { return this.inner.getHeader(key); }
  removeHeader(key: string): this { this.inner.removeHeader(key); return this; }

  send<T>(data: T, message?: string): void {
    if (!this._sent) {
      this._sent = true;
      this.validator.validateResponse(this.routeId, data, this.inner.statusCode);
    }
    if (this.method === 'HEAD') return this.inner.send(undefined, message);
    this.inner.send(data, message);
  }

  sendRaw(payload: any, contentType?: string): void { this.inner.sendRaw(payload, contentType); }

  /** @deprecated See AxiomifyResponse.error */
  error(err: unknown): void { this.inner.error(err); }

  stream(readable: import('stream').Readable, contentType?: string): void {
    this.inner.stream(readable, contentType);
  }

  get capabilities() { return this.inner.capabilities ?? { sse: false, streaming: false }; }
  sseInit(ms?: number): void { this.inner.sseInit?.(ms); }
  sseSend(data: any, event?: string): void { this.inner.sseSend?.(data, event); }
  get statusCode(): number { return this.inner.statusCode; }
  get raw(): unknown { return this.inner.raw; }
  get headersSent(): boolean { return this.inner.headersSent; }
}
