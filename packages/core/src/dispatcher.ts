import { getCompiledState } from './compiled';
import type { HookManager } from './lifecycle';
import type { Router } from './router';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
} from './types';
import { ValidationError } from './validation';
import type { ValidationCompiler } from './validation';

export class RequestDispatcher {
  private _notFoundHandler: (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) => void | Promise<void> = (req, res) => {
    res.status(404).send(null, 'Route not found');
  };

  private _methodNotAllowedHandler: (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) => void | Promise<void> = (req, res) => {
    res.status(405).send(null, 'Method Not Allowed');
  };

  public setNotFoundHandler(
    handler: (
      req: AxiomifyRequest,
      res: AxiomifyResponse,
    ) => void | Promise<void>,
  ): void {
    this._notFoundHandler = handler;
  }

  public setMethodNotAllowedHandler(
    handler: (
      req: AxiomifyRequest,
      res: AxiomifyResponse,
    ) => void | Promise<void>,
  ): void {
    this._methodNotAllowedHandler = handler;
  }

  constructor(
    private readonly router: Router,
    private readonly hooks: HookManager,
    private readonly validator: ValidationCompiler,
  ) {}

  public async handle(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    try {
      const onRequestRet = this.hooks.run('onRequest', req, res);
      if (onRequestRet) await onRequestRet;
      if (res.headersSent) return;

      const reqParams = req.params as Record<string, string>;
      const match = this.router.lookup(req.method, req.path, reqParams);
      if (!match) {
        await this._notFoundHandler(req, res);
        return;
      }
      if ('error' in match) {
        const allowed = [...match.allowed];
        if (!allowed.includes('OPTIONS')) {
          allowed.push('OPTIONS');
        }
        res.header('Allow', allowed.join(', '));
        await this._methodNotAllowedHandler(req, res);
        return;
      }

      await this.executeMatchedRoute(req, res, match.route, reqParams);
    } catch (err) {
      await this.handleError(err, req, res);
    } finally {
      if (res.isStreaming) {
        res.onStreamClose = () => {
          const onCloseRet = this.hooks.runSafe('onClose', req, res);
          if (onCloseRet) onCloseRet.catch(() => {});
        };
      } else {
        const onCloseRet = this.hooks.runSafe('onClose', req, res);
        if (onCloseRet) await onCloseRet;
      }
    }
  }

  /**
   * Entry point for adapters that perform their own routing (uWS)
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
      const onRequestRet = this.hooks.run('onRequest', req, res);
      if (onRequestRet) await onRequestRet;
      if (res.headersSent) return;
      await this.executeMatchedRoute(req, res, route, params);
    } catch (err) {
      await this.handleError(err, req, res);
    } finally {
      if (res.isStreaming) {
        res.onStreamClose = () => {
          const onCloseRet = this.hooks.runSafe('onClose', req, res);
          if (onCloseRet) onCloseRet.catch(() => {});
        };
      } else {
        const onCloseRet = this.hooks.runSafe('onClose', req, res);
        if (onCloseRet) await onCloseRet;
      }
    }
  }

  private async executeMatchedRoute(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    route: RouteDefinition,
    params: Record<string, string>,
  ): Promise<void> {
    // Skip the params copy when params IS req.params (the router-routed path
    // writes directly into req.params, so no copy is needed). For the adapter-
    // routed path, copy via Object.assign — faster than for-in on plain objects
    // because V8's Object.assign uses inline caches and skips prototype walk.
    const reqParams = req.params as Record<string, string>;
    if (reqParams !== params) {
      Object.assign(reqParams, params);
    }

    // Run onPreHandler hooks at dispatch time (not baked into the compiled
    // pipeline) so late-registered hooks still execute and we pay zero cost
    // when no onPreHandler hooks are registered.
    const preHandlerList = this.hooks.hooks.onPreHandler;
    if (preHandlerList.length > 0) {
      const ret = this.hooks.run('onPreHandler', req, res, {
        route,
        params: reqParams,
      });
      if (ret) await ret;
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
    //
    // Sync fast-path: check whether the return value is a Promise before
    // awaiting — avoids creating a microtask for synchronous middleware/handlers
    // (the common case for lightweight in-process operations).
    if (pipeline.length === 1) {
      if (!req.signal?.aborted) {
        const ret = pipeline[0](req, dispatchRes);
        if (ret !== undefined && typeof (ret as any).then === 'function')
          await ret;
      }
    } else {
      for (let i = 0; i < pipeline.length; i++) {
        if (dispatchRes.headersSent || req.signal?.aborted) break;
        const ret = pipeline[i](req, dispatchRes);
        if (ret !== undefined && typeof (ret as any).then === 'function')
          await ret;
      }
    }

    const postRet = this.hooks.run('onPostHandler', req, dispatchRes, {
      route,
      params,
    });
    if (postRet) await postRet;
  }

  private async handleError(
    err: unknown,
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ): Promise<void> {
    const onErrorRet = this.hooks.runSafe('onError', err, req, res);
    if (onErrorRet) await onErrorRet;
    if (res.headersSent) return;

    const anyErr = err as Record<string, unknown>;

    // Derive HTTP status code from error. HttpError / AxiomifyError / ValidationError
    // all carry .statusCode; plain Error objects default to 500.
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

    // ValidationError carries structured field errors; always safe to send.
    if (err instanceof ValidationError) {
      res
        .status(err.statusCode || 400)
        .send(err.errors || (anyErr as any).issues, err.message);
      return;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      // In production: never leak internal details.
      // Known HTTP errors (4xx) surface their message; 5xx are generic.
      if (statusCode < 500) {
        res.status(statusCode).send(null, message);
      } else {
        res
          .status(statusCode)
          .send(
            { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
            'Internal Server Error',
          );
      }
      return;
    }

    // Non-production: surface structured error detail but NEVER include stack
    // traces in the HTTP response body — stacks belong in server logs only.
    // Stack trace leakage in staging/dev has caused real breaches.
    if (typeof anyErr.stack === 'string') {
      // Log internally
      console.error('[Axiomify] Unhandled error:', anyErr.stack);
    }

    const errorData = anyErr.issues ?? anyErr.errors ?? undefined;
    res.status(statusCode).send(errorData, message);
  }
}

/**
 * Wraps a response to perform response-schema validation on the first send()
 * call, and to handle HEAD-method body suppression.
 *
 * Only instantiated when the route has a schema.response defined.
 * For all other routes the dispatcher uses the inner response directly.
 *
 * Every `AxiomifyResponse` member is forwarded by hand rather than through a
 * generic Proxy (the extra indirection isn't worth paying on a path this
 * hot). Because `cookie`, `clearCookie`, `sseInit`, `sseSend`, `isStreaming`
 * and `onStreamClose` are all OPTIONAL on the interface, `implements
 * AxiomifyResponse` does NOT catch a forwarder that's missing for a new
 * optional member — `tests/dispatcher-forwarding.test.ts` is the actual
 * safety net: it asserts every property a real adapter response exposes
 * also exists here. Update that test's reference shape (and this class)
 * together whenever `AxiomifyResponse` gains a new member.
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
  cookie(
    name: string,
    value: string,
    options?: import('./cookies').CookieOptions,
  ): this {
    if (typeof this.inner.cookie !== 'function') {
      throw new Error(
        '[Axiomify] The active adapter does not implement res.cookie().',
      );
    }
    this.inner.cookie(name, value, options);
    return this;
  }
  clearCookie(
    name: string,
    options?: Pick<
      import('./cookies').CookieOptions,
      'domain' | 'path' | 'secure' | 'sameSite'
    >,
  ): this {
    if (typeof this.inner.clearCookie !== 'function') {
      throw new Error(
        '[Axiomify] The active adapter does not implement res.clearCookie().',
      );
    }
    this.inner.clearCookie(name, options);
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
    }
    this.inner.send(data, message); // NativeResponse handles HEAD suppression
  }

  sendRaw(payload: any, contentType?: string): void {
    this.inner.sendRaw(payload, contentType);
  }

  stream(readable: import('stream').Readable, contentType?: string): void {
    this.inner.isStreaming = true;
    this.inner.stream(readable, contentType);
  }

  get capabilities() {
    return this.inner.capabilities ?? { sse: false, streaming: false };
  }
  sseInit(ms?: number): void {
    if (
      !this.inner.capabilities?.sse ||
      typeof this.inner.sseInit !== 'function'
    ) {
      throw new Error(
        '[Axiomify] The active adapter does not implement SSE responses.',
      );
    }
    this.inner.sseInit(ms);
  }
  sseSend(data: any, event?: string): void {
    if (
      !this.inner.capabilities?.sse ||
      typeof this.inner.sseSend !== 'function'
    ) {
      throw new Error(
        '[Axiomify] The active adapter does not implement SSE responses.',
      );
    }
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
  get isStreaming(): boolean | undefined {
    return this.inner.isStreaming;
  }
  get onStreamClose(): (() => void) | null | undefined {
    return this.inner.onStreamClose;
  }
  set onStreamClose(cb: (() => void) | null | undefined) {
    this.inner.onStreamClose = cb ?? null;
  }
}
