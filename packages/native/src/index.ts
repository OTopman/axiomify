import type {
  AdapterLockToken,
  Axiomify,
  HttpMethod,
  SerializerInput,
} from '@axiomify/core';
import { ADAPTER_LOCK_TOKEN, makeSerialize } from '@axiomify/core';
import cluster from 'cluster';
import { cpus } from 'node:os';
import { availableParallelism } from 'os';
import type {
  TemplatedApp,
  HttpRequest as UWSRequest,
  HttpResponse as UWSResponse,
  WebSocketBehavior,
} from 'uWebSockets.js';
import uWS from 'uWebSockets.js';

import { getSimdParse, parseBodyBuffer, readBody } from './body';
import { buildErrorCache, ErrorCache, statusLine } from './error-cache';
import { collectHeaders } from './headers';
import { fastParseQuery, safeDecodeURIComponent } from './query';
import { NativeRequest } from './request';
import { NativeResponse } from './response';

// ---------------------------------------------------------------------------
// Adapter-local helpers
//
// Only utilities that are tightly coupled to the adapter's own request
// dispatch live here. NativeRequest, NativeResponse, body parsing, headers,
// query, status lines, and the error cache are all in sibling modules.
// ---------------------------------------------------------------------------

/**
 * Extracts parameter key names from an Axiomify path in order.
 *
 *   /users/:id/posts/:postId → ['id', 'postId']
 *   /static/*                → ['*']
 *
 * Used at registration time to build the index → name map that
 * `req.getParameter(i)` results are bound to. Runs once per route on
 * startup; zero per-request overhead.
 */
function extractParamKeys(path: string): string[] {
  const keys: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.startsWith(':')) keys.push(segment.slice(1));
    else if (segment === '*') keys.push('*');
  }
  return keys;
}

/**
 * Reusable TextDecoder for IP address extraction. uWS returns remote
 * addresses as an ArrayBuffer; this avoids the Buffer.from() → toString()
 * allocation chain (saves ~0.079µs per request).
 */
const _ipDecoder = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// WebSocket types
// ---------------------------------------------------------------------------

type WsUserData = { url: string; headers: Record<string, string | string[]> };

export interface NativeWsOptions {
  /** WebSocket endpoint path. @default '/ws' */
  path?: string;
  compression?: number;
  maxPayloadLength?: number;
  idleTimeout?: number;
  open?: (ws: unknown) => void;
  message?: (ws: unknown, message: ArrayBuffer, isBinary: boolean) => void;
  close?: (ws: unknown, code: number, message: ArrayBuffer) => void;
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface NativeAdapterTlsOptions {
  /** Path to the PEM private key file. */
  keyFile: string;
  /** Path to the PEM certificate file. */
  certFile: string;
  /** Optional passphrase for the private key file. */
  passphrase?: string;
  /** Optional path to DH parameters file. */
  dhParamsFile?: string;
  /** Optional flag to prefer low memory usage in SSL/TLS. */
  preferLowMemoryUsage?: boolean;
}

export interface NativeAdapterOptions {
  /** Listening port. @default 3000 */
  port?: number;
  /** Optional SSL/TLS configuration to run as an HTTPS server. */
  tls?: NativeAdapterTlsOptions;
  /**
   * Maximum request body size in bytes. Requests exceeding this are
   * immediately rejected with 413. @default 1 MiB
   */
  maxBodySize?: number;
  /**
   * When true, derive the client IP from `X-Forwarded-For` via uWS's
   * `getProxiedRemoteAddressAsText()`. Only enable behind a trusted proxy.
   * @default false
   */
  trustProxy?: boolean;
  proxyIpValidator?: (ip: string) => boolean;
  /**
   * WebSocket endpoint configuration. Omit to disable WebSocket support.
   * Set to `false` to explicitly disable.
   */
  ws?: NativeWsOptions | false;
  /**
   * Number of worker processes to spawn for `listenClustered()`.
   * Defaults to the number of logical CPU cores.
   *
   * Each worker runs its own uWS event loop. uWS natively supports SO_REUSEPORT
   * so all workers bind the same port — the kernel load-balances connections.
   * This is the most efficient multi-core strategy for uWS.
   *
   * Only used by `listenClustered()` — `listen()` is always single-process.
   */
  workers?: number;
  /**
   * Opt-in to the userspace L4 TCP proxy used by `listenClustered()` on
   * non-Linux platforms (macOS, Windows). uWS's `SO_REUSEPORT` clustering is
   * Linux-only; on other platforms the primary process must proxy traffic to
   * worker processes in userspace, which adds two event-loop hops per byte
   * and roughly negates the perf benefit of using uWS in the first place.
   *
   * `listenClustered()` will THROW on non-Linux unless this flag is `true`.
   * Set it explicitly only if you understand the tradeoff. On Linux this
   * flag is ignored.
   *
   * @default false
   */
  allowUserspaceProxy?: boolean;
  /**
   * Optional structured logger for adapter-level warnings (userspace proxy
   * activation, worker respawn, etc.). Falls back to `console` when omitted.
   */
  logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
  /**
   * Global request timeout in milliseconds. If the request handler does not
   * respond (i.e. headers are not sent) within this duration, the connection
   * is closed with a 504 status.
   * Omit or set to 0 to disable.
   * @default 0 (disabled)
   */
  requestTimeout?: number;
  /**
   * Number of workers to restart concurrently during a rolling restart (SIGUSR2).
   * @default 1
   */
  restartParallelism?: number;
}

// ---------------------------------------------------------------------------
// NativeAdapter
// ---------------------------------------------------------------------------

export class NativeAdapter {
  private readonly _app: Axiomify;
  private readonly _port: number;
  private readonly _server: TemplatedApp;
  private readonly _maxBodySize: number;
  private readonly _trustProxy: boolean;
  private readonly _proxyIpValidator?: (ip: string) => boolean;
  private readonly _workers: number;
  private readonly _allowUserspaceProxy: boolean;
  private readonly _logger: NonNullable<NativeAdapterOptions['logger']>;
  private readonly _requestTimeout: number;
  private readonly _restartParallelism: number;
  /** Serializer arity cached at construction time — not re-checked per request. */
  private readonly _serialize: (input: SerializerInput) => unknown;
  private _listenSocket: unknown = null;
  private _onShutdown?: () => void | Promise<void>;
  // Tracks the count of requests that have entered the async pipeline and
  // not yet completed. gracefulShutdown() waits on this to hit zero before
  // running the user's onShutdown. Without it, `process.exit(0)` would kill
  // requests mid-response — classic source of double-charge bugs in fintech
  // (DB write happens, client never sees the 200, client retries).
  private _inflight = 0;
  private _drainResolvers: (() => void)[] = [];
  private readonly _errorCache: ErrorCache;
  private readonly _lockToken = Symbol('axiomify.native.lock');

  constructor(app: Axiomify, options: NativeAdapterOptions = {}) {
    this._app = app;
    this._app.lockRoutes(this._lockToken, '@axiomify/native');
    this._port = options.port ?? 3000;
    this._maxBodySize = options.maxBodySize ?? 1_048_576;
    this._trustProxy = options.trustProxy ?? false;
    this._workers = options.workers ?? availableParallelism();
    this._allowUserspaceProxy = options.allowUserspaceProxy ?? false;
    this._logger = options.logger ?? {
      warn: (msg, meta) => console.warn(msg, meta ?? ''),
      error: (msg, meta) => console.error(msg, meta ?? ''),
    };
    this._serialize = makeSerialize(this._app.serializer);

    // Per-adapter error envelope cache. setSerializer is locked by core
    // once routes are locked (see core/src/app.ts), so the serializer here
    // matches what live responses will use.
    this._errorCache = buildErrorCache(this._app.serializer);

    if (options.tls) {
      this._server = uWS.SSLApp({
        key_file_name: options.tls.keyFile,
        cert_file_name: options.tls.certFile,
        passphrase: options.tls.passphrase,
        dh_params_file_name: options.tls.dhParamsFile,
        ssl_prefer_low_memory_usage: options.tls.preferLowMemoryUsage,
      });
    } else {
      this._server = uWS.App();
    }

    // WebSocket support (optional)
    if (options.ws !== false && options.ws !== undefined) {
      this._registerWs(options.ws);
    }

    // Register all Axiomify routes directly with uWS's C++ router.
    // uWS resolves method+path in native code — no JavaScript routing overhead.
    this._registerWsRoutes();
    this._registerRoutes();

    // 404 / 405 catch-all. Must be registered LAST — uWS matches routes in
    // registration order, specific patterns take priority over `any('/*')`.
    this._registerFallback();
  }

  // -------------------------------------------------------------------------
  // Route registration
  // -------------------------------------------------------------------------

  private _registerRoutes(): void {
    const normalizedPaths = new Map<string, string>();
    for (const route of this._app.registeredRoutes) {
      const norm = route.method + ' ' + route.path.split('/').map(s => s.startsWith(':') ? ':*' : s).join('/');
      const existing = normalizedPaths.get(norm);
      if (existing && existing !== route.path) {
        const msg = `AxiomifyError: Conflicting parameterized routes: "${existing}" and "${route.path}" resolve ambiguously. Use distinct path structures.`;
        if (this._app.routeConflict === 'throw') {
          throw new AxiomifyError(msg);
        } else {
          this._logger.warn(msg);
        }
      } else {
        normalizedPaths.set(norm, route.path);
      }
    }

    // Aggregate registered methods per path so we can register per-path
    // catch-alls for the unregistered methods. Without this, a request to
    // POST /resource where only GET is registered falls through to the
    // global any('/*') fallback and returns 404 — wrong per RFC 9110 §15.5.6
    // (must be 405 with Allow: <methods>). Some gateways/caches treat 404 as
    // cacheable and 405 as not, so the spec compliance matters operationally.
    const pathMethods = new Map<string, Set<HttpMethod>>();

    for (const route of this._app.registeredRoutes) {
      const paramKeys = extractParamKeys(route.path);
      const handler = this._makeHandler(route, paramKeys);
      const method = route.method;

      const set = pathMethods.get(route.path) ?? new Set<HttpMethod>();
      set.add(method);
      pathMethods.set(route.path, set);

      if (method === 'GET') {
        this._server.get(route.path, handler);

        // uWS does not auto-generate HEAD for GET. Register it explicitly
        // unless the user already defined a HEAD route for the same path.
        const hasExplicitHead = this._app.registeredRoutes.some(
          (r) => r.method === 'HEAD' && r.path === route.path,
        );
        if (!hasExplicitHead) {
          const headHandler = this._makeHandler(route, paramKeys);
          this._server.head(route.path, headHandler);
          set.add('HEAD');
        }
      } else if (method === 'DELETE') {
        this._server.del(route.path, handler);
      } else if (method === 'HEAD') {
        this._server.head(route.path, handler);
      } else if (method === 'OPTIONS') {
        this._server.options(route.path, handler);
      } else if (method === 'PATCH') {
        this._server.patch(route.path, handler);
      } else if (method === 'PUT') {
        this._server.put(route.path, handler);
      } else if (method === 'POST') {
        this._server.post(route.path, handler);
      }
    }

    // Register a per-path `any` AFTER all method handlers, scoped to the
    // exact path. uWS matches in registration order, so the specific
    // method handlers above take precedence; only an unregistered method
    // for a registered path lands here, producing the correct 405.
    const cached405Body = this._errorCache.cached405Body;
    for (const [path, methods] of pathMethods) {
      // Auto-register OPTIONS to allow `onRequest` hooks (e.g. CORS) to intercept.
      // If not intercepted, returns 204 with Allow header per RFC 9110 §9.3.7.
      if (!methods.has('OPTIONS')) {
        const paramKeys = extractParamKeys(path);
        const allowMethods = Array.from(methods).sort().join(', ');

        const optionsRoute = {
          method: 'OPTIONS',
          path,
          handler: (_req: unknown, res: any) => {
            res.header('Allow', allowMethods);
            res.status(204).send(null);
          },
        } as any;

        this._server.options(path, this._makeHandler(optionsRoute, paramKeys));
        methods.add('OPTIONS');
      }

      const allow = Array.from(methods).sort().join(', ');
      this._server.any(path, (res: UWSResponse, _req: UWSRequest) => {
        res.onAborted(() => {});
        res.cork(() => {
          res.writeStatus(statusLine(405));
          res.writeHeader('Allow', allow);
          res.writeHeader('Content-Type', 'application/json');
          res.end(cached405Body);
        });
      });
    }
  }

  private _registerFallback(): void {
    const cached404 = this._errorCache.cached404;
    this._server.any('/*', (res: UWSResponse, _req: UWSRequest) => {
      res.onAborted(() => {});
      res.cork(() => {
        res.writeStatus(cached404.statusLine);
        res.writeHeader('Content-Type', 'application/json');
        res.end(cached404.body);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Per-route request handler factory
  // -------------------------------------------------------------------------

  private _makeHandler(
    route: (typeof this._app.registeredRoutes)[number],
    paramKeys: readonly string[],
  ) {
    const adapter = this; // captured for inflight tracking
    const app = this._app;
    const maxBodySize = this._maxBodySize;
    const trustProxy = this._trustProxy;
    const serialize = this._serialize; // captured once per route, not per request
    const errorCache = this._errorCache; // captured per-route, scoped to this adapter
    const cached413 = errorCache.cached413;
    const method = route.method;
    const needsBody =
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE';

    return (res: UWSResponse, req: UWSRequest): void => {
      // --- SYNCHRONOUS SECTION ---
      // uWS requires that all synchronous reads from `req` happen in this
      // callback. The HttpRequest object is ONLY valid until the first `await`.
      // We capture everything we need before going async.

      let aborted = false;

      // Extract path params by index — O(k) where k = number of params.
      const params: Record<string, string> = Object.create(null);
      for (let i = 0; i < paramKeys.length; i++) {
        const val = req.getParameter(i);
        if (val !== '') params[paramKeys[i]] = val;
      }

      // Collect all request headers in one pass. Multi-value headers
      // (RFC 9110 §5.3) are preserved as arrays.
      const headers = collectHeaders(req);

      const url = req.getUrl();
      const queryStr = req.getQuery();
      const ctRaw = headers['content-type'];
      const contentType = (Array.isArray(ctRaw) ? ctRaw[0] : ctRaw) ?? '';
      const ip = adapter._extractIp(res);

      // Construct request and response objects.
      const axiomifyReq = new NativeRequest(
        method,
        url,
        ip,
        headers,
        queryStr,
        undefined,
      );
      axiomifyReq.params = params;
      let timeoutTimer: NodeJS.Timeout | null = null;
      if (adapter._requestTimeout > 0) {
        timeoutTimer = setTimeout(() => {
          if (!aborted && !axiomifyRes.headersSent) {
            aborted = true;
            axiomifyReq.onAbort();
            axiomifyRes.aborted = true;
            res.cork(() => {
              res.writeStatus('504 Gateway Timeout');
              res.writeHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Gateway Timeout' }));
            });
          }
        }, adapter._requestTimeout);
      }

      const axiomifyRes = new NativeResponse(
        res,
        app,
        axiomifyReq,
        method,
        serialize,
        errorCache,
        () => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
        },
      );

      // Register abort handler BEFORE any async work.
      res.onAborted(() => {
        aborted = true;
        axiomifyReq.onAbort();
        axiomifyRes.aborted = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
      });

      // --- ASYNC SECTION ---
      adapter._inflight++;
      (async () => {
        // Body reading for methods that carry a request body.
        if (needsBody) {
          const result = await readBody(res, maxBodySize, () => {
            aborted = true;
            axiomifyReq.onAbort();
          });

          if (result === null) {
            // Client disconnected mid-body; nothing to do.
            return;
          }

          if (result.tooLarge) {
            if (!aborted) {
              axiomifyRes.aborted = false; // reset to allow send
              const dummyRoute = {
                method: route.method,
                path: route.path,
                handler: (_req: any, r: any) => {
                  r.status(413).send(null, 'Payload Too Large');
                },
              } as any;

              compiledStates.set(dummyRoute, {
                pipeline: [dummyRoute.handler],
                hasResponseSchema: false,
              });

              app
                .handleMatchedRoute(
                  adapter._lockToken,
                  axiomifyReq,
                  axiomifyRes,
                  dummyRoute,
                  params,
                )
                .catch(() => {
                  if (!aborted) {
                    res.cork(() => {
                      res.writeStatus(cached413.statusLine);
                      res.writeHeader('Content-Type', 'application/json');
                      res.end(cached413.body);
                    });
                  }
                });
            }
            return;
          }

          // Set parsed body on the request. Done after body read because
          // NativeRequest.body must be set before the handler sees it.
          (axiomifyReq as unknown as { body: unknown }).body = parseBodyBuffer(
            result.raw,
            contentType,
          );
        }

        if (aborted) return;
        axiomifyRes.aborted = aborted;

        await app.handleMatchedRoute(
          adapter._lockToken,
          axiomifyReq,
          axiomifyRes,
          route,
          params,
        );
      })()
        .catch((err: unknown) => {
          // A .catch() is mandatory on all uWS async handlers. Without it, any
          // unhandled rejection (handler bug, DB drop, timeout) reaches Node's
          // 'unhandledRejection' event, which crashes the process in Node 15+.
          // Instead we try to send a 500 — if the response is already committed
          // (headersSent) we swallow silently, which is still safe.
          if (!aborted && !axiomifyRes.headersSent) {
            try {
              // Do NOT use axiomifyRes.error(err) — that deprecated method always
              // sends 500 and does not respect err.statusCode. Inline the same
              // logic used by RequestDispatcher.handleError so HTTP error status
              // codes thrown by handlers are preserved.
              const anyErr = err as Record<string, unknown>;
              const errStatus =
                typeof anyErr.statusCode === 'number'
                  ? anyErr.statusCode
                  : typeof anyErr.status === 'number'
                    ? anyErr.status
                    : 500;
              const errMsg =
                typeof anyErr.message === 'string'
                  ? anyErr.message
                  : 'Internal Server Error';
              axiomifyRes.status(errStatus).send(null, errMsg);
            } catch {
              // axiomifyRes.send() itself threw (e.g. already aborted between the
              // check and the call) — nothing more we can do.
            }
          }
        })
        .finally(() => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
          // Decrement BEFORE notifying drain resolvers so a resolver that
          // schedules `process.exit(0)` sees a consistent count.
          adapter._inflight--;
          if (adapter._inflight === 0 && adapter._drainResolvers.length > 0) {
            const resolvers = adapter._drainResolvers;
            adapter._drainResolvers = [];
            for (const r of resolvers) r();
          }
        });
    };
  }

  /**
   * Returns a Promise that resolves when there are no in-flight requests.
   * If the adapter is already idle, resolves synchronously on the next tick.
   * Used by `gracefulShutdown()`; not part of the public stable API.
   * @internal
   */
  private _waitForDrain(): Promise<void> {
    if (this._inflight === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this._drainResolvers.push(resolve);
    });
  }

  // -------------------------------------------------------------------------
  // WebSocket registration
  // -------------------------------------------------------------------------

  private _registerWs(opts: NativeWsOptions): void {
    const wsPath = opts.path ?? '/ws';

    const behavior: WebSocketBehavior<WsUserData> = {
      compression: opts.compression ?? uWS.SHARED_COMPRESSOR,
      maxPayloadLength: opts.maxPayloadLength ?? 256 * 1024,
      idleTimeout: opts.idleTimeout ?? 120,

      upgrade: (res: UWSResponse, req: UWSRequest, context: unknown) => {
        const url = req.getUrl();
        const secWebSocketKey = req.getHeader('sec-websocket-key');
        const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
        const secWebSocketExtensions = req.getHeader(
          'sec-websocket-extensions',
        );

        const headers = collectHeaders(req);

        res.onAborted(() => {});

        res.cork(() => {
          res.upgrade(
            { url, headers },
            secWebSocketKey,
            secWebSocketProtocol,
            secWebSocketExtensions,
            context,
          );
        });
      },

      open: opts.open ?? (() => {}),
      message: opts.message ?? (() => {}),
      close: opts.close ?? (() => {}),
    };

    this._server.ws<WsUserData>(wsPath, behavior);
  }

  private _registerWsRoutes(): void {
    const validator = this._app.validator;
    const trustProxy = this._trustProxy;

    for (const route of this._app.registeredWsRoutes) {
      const paramKeys = extractParamKeys(route.path);
      const routeId = `WS:${route.path}`;

      const behavior: WebSocketBehavior<any> = {
        compression: route.compression ?? uWS.SHARED_COMPRESSOR,
        maxPayloadLength: route.maxPayloadLength ?? 256 * 1024,
        idleTimeout: route.idleTimeout ?? 120,

        upgrade: (res: UWSResponse, req: UWSRequest, context: unknown) => {
          let aborted = false;

          const params: Record<string, string> = Object.create(null);
          for (let i = 0; i < paramKeys.length; i++) {
            const val = req.getParameter(i);
            if (val !== '') params[paramKeys[i]] = val;
          }

          const headers = collectHeaders(req);

          const url = req.getUrl();
          const queryStr = req.getQuery();
          const ip = this._extractIp(res);

          // WS handshake headers MUST be single-valued per RFC 6455 §4.1.
          // If a client somehow sent multiples, take the first to match the
          // browser/proxy norm rather than silently dropping the handshake.
          const firstStr = (
            h: string | string[] | undefined,
          ): string | undefined => (Array.isArray(h) ? h[0] : h);
          const secWebSocketKey = firstStr(headers['sec-websocket-key']) ?? '';
          const secWebSocketProtocol =
            firstStr(headers['sec-websocket-protocol']) ?? '';
          const secWebSocketExtensions =
            firstStr(headers['sec-websocket-extensions']) ?? '';

          const axiomifyReq = new NativeRequest(
            'GET',
            url,
            ip,
            headers,
            queryStr,
            undefined,
          );
          axiomifyReq.params = params;
          const axiomifyRes = new NativeResponse(
            res,
            this._app,
            axiomifyReq,
            'GET',
            this._serialize,
            this._errorCache,
          );

          res.onAborted(() => {
            aborted = true;
            axiomifyReq.onAbort();
            axiomifyRes.aborted = true;
          });

          (async () => {
            // Run onRequest hooks (security, CORS, request-ID, etc.)
            const onRequestRet = this._app.hooks.run(
              'onRequest',
              axiomifyReq,
              axiomifyRes,
            );
            if (onRequestRet) await onRequestRet;
            if (axiomifyRes.headersSent || aborted) return;

            // Run onPreHandler hooks (rate-limit, auth plugins, etc.)
            const onPreHandlerRet = this._app.hooks.run(
              'onPreHandler',
              axiomifyReq,
              axiomifyRes,
              { route: route as any, params },
            );
            if (onPreHandlerRet) await onPreHandlerRet;
            if (axiomifyRes.headersSent || aborted) return;

            // Route-level plugins
            if (route.plugins) {
              for (const plugin of route.plugins) {
                if (axiomifyRes.headersSent || aborted) break;
                const ret = plugin(axiomifyReq, axiomifyRes);
                if (ret instanceof Promise) await ret;
              }
            }
            if (axiomifyRes.headersSent || aborted) return;

            res.upgrade(
              { state: axiomifyReq.state, req: axiomifyReq },
              secWebSocketKey,
              secWebSocketProtocol,
              secWebSocketExtensions,
              context,
            );
          })().catch((err: unknown) => {
            if (!aborted && !axiomifyRes.headersSent) {
              const e = err as Record<string, unknown>;
              axiomifyRes
                .status(typeof e.statusCode === 'number' ? e.statusCode : 500)
                .send(
                  null,
                  typeof e.message === 'string'
                    ? e.message
                    : 'Internal Server Error',
                );
            }
          });
        },

        open: (ws: any) => {
          const client = {
            state: ws.state,
            send: (message: any, isBinary?: boolean) => {
              const data =
                typeof message === 'string' || Buffer.isBuffer(message)
                  ? message
                  : JSON.stringify(message);
              ws.send(data, isBinary);
            },
            close: () => ws.close(),
            subscribe: (topic: string) => ws.subscribe(topic),
            unsubscribe: (topic: string) => ws.unsubscribe(topic),
            publish: (topic: string, message: any, isBinary?: boolean) => {
              const data =
                typeof message === 'string' || Buffer.isBuffer(message)
                  ? message
                  : JSON.stringify(message);
              ws.publish(topic, data, isBinary);
            },
          };
          ws.client = client;
          if (route.open) {
            route.open(client, ws.req);
          }
        },

        message: (ws: any, message: ArrayBuffer, isBinary: boolean) => {
          if (!route.message) return;

          // Binary payloads bypass JSON parsing and schema validation —
          // the handler receives a Buffer. uWS reuses the ArrayBuffer after
          // this callback, so the copy MUST happen before the handler runs.
          if (isBinary) {
            route.message(ws.client, Buffer.from(message.slice(0)));
            return;
          }

          // Text payloads: defensive deep copy first (uWS recycles the
          // ArrayBuffer), then optional simdjson + Zod schema validation.
          const safeBuffer = Buffer.from(message.slice(0));
          let parsedData: unknown = safeBuffer;

          if (route.schema?.message) {
            const asStr = safeBuffer.toString('utf8');

            // Parse JSON. A parse failure here is treated the same as a
            // schema violation — the message never reaches the handler.
            try {
              const simd = getSimdParse();
              parsedData = simd !== null ? simd(asStr) : JSON.parse(asStr);
            } catch (err: unknown) {
              const isProduction = process.env.NODE_ENV === 'production';
              ws.client.send(
                isProduction
                  ? { error: 'Invalid message' }
                  : {
                      error: 'Invalid message',
                      details: { body: { _root: (err as Error).message } },
                    },
              );
              return;
            }

            // Run the compiled validator registered at app.ws() time.
            // ValidationCompiler.execute() throws ValidationError on failure;
            // catch and surface to the client as a schema rejection.
            try {
              validator.execute(routeId + ':message', {
                body: parsedData,
              } as any);
            } catch (err: unknown) {
              const isProduction = process.env.NODE_ENV === 'production';
              const details = (err as { errors?: unknown }).errors;
              ws.client.send(
                isProduction
                  ? { error: 'Invalid message' }
                  : { error: 'Invalid message', details },
              );
              return;
            }
          }

          route.message(ws.client, parsedData);
        },

        close: (ws: any, code: number, message: ArrayBuffer) => {
          if (route.close) {
            route.close(ws.client, code, Buffer.from(message).toString('utf8'));
          }
        },

        drain: (ws: any) => {
          if (route.drain) route.drain(ws.client);
        },
      };

      this._server.ws<any>(route.path, behavior);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the server on a single Node.js event loop.
   * Use `listenClustered()` to saturate multiple CPU cores.
   */
  public listen(
    callback?: (port: number) => void,
    onError?: (err: Error) => void,
    portOverride?: number,
  ): void {
    const port = portOverride ?? this._port;
    this._server.listen('0.0.0.0', port, (token: unknown) => {
      if (token) {
        this._listenSocket = token;
        this._installCrashGuard();
        callback?.((uWS as any).us_socket_local_port(token));
      } else {
        const err = new Error(
          `[Axiomify/native] Port ${this._port} is occupied.`,
        );
        if (onError) {
          onError(err);
        } else {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    });
  }

  /**
   * Installs process-level crash guards that close the uWS listen socket
   * on any fatal exit path (uncaught exception, unhandled rejection, SIGINT,
   * SIGTERM). Without this, a crash leaves the port in TIME_WAIT and the
   * process cannot restart on the same port immediately.
   *
   * Guards are installed exactly once per adapter instance and are idempotent
   * — calling `close()` multiple times is safe.
   *
   * The signal handlers installed here are stored on the instance so
   * `gracefulShutdown()` can detach them and take ownership of SIGINT/SIGTERM,
   * regardless of which method the caller invokes first.
   */
  private _crashGuardInstalled = false;
  private _crashSignalHandlers: {
    sig: 'SIGINT' | 'SIGTERM';
    fn: () => void;
  }[] = [];
  private _installCrashGuard(): void {
    if (this._crashGuardInstalled) return;
    this._crashGuardInstalled = true;

    const cleanup = () => this.close();

    // 'exit' is the last chance — runs synchronously, no async allowed.
    process.once('exit', cleanup);

    // If gracefulShutdown() already claimed signal ownership, stop here —
    // the 'exit' guard above still runs if anything else kills the process.
    if (this._onShutdown !== undefined) return;

    // Interactive stop (Ctrl+C) and orchestrator signals.
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const fn = () => {
        cleanup();
        process.exit(0);
      };
      this._crashSignalHandlers.push({ sig, fn });
      process.once(sig, fn);
    }
  }

  /**
   * Spawn `workers` child processes (default: one per CPU core) and start the
   * server on each. All workers bind the same port directly via uWS's
   * `SO_REUSEPORT` — the kernel load-balances connections with no IPC overhead.
   *
   * SIGTERM is forwarded to all live workers for graceful drain. `onPrimary`
   * fires only once ALL workers have signalled readiness — not immediately
   * after forking.
   *
   * @example
   * const adapter = new NativeAdapter(app, { port: 3000 });
   * adapter.listenClustered({
   *   onWorkerReady: () => console.log(`Worker ${process.pid} listening`),
   *   onPrimary: (pids) => console.log('Primary', process.pid, '→ workers', pids),
   * });
   */
  /* v8 ignore start -- clustering requires real OS process forking */
  public listenClustered(
    opts: {
      onWorkerReady?: () => void;
      onPrimary?: (pids: number[]) => void;
      onWorkerExit?: (pid: number, code: number | null) => void;
      gracefulTimeoutMs?: number;
    } = {},
  ): void {
    const gracefulTimeoutMs = opts.gracefulTimeoutMs ?? 10_000;
    const isLinux = process.platform === 'linux';

    // ── Platform gate ───────────────────────────────────────────────────
    // uWS's SO_REUSEPORT clustering only works on Linux. On macOS/Windows we
    // would fall back to a userspace L4 proxy that defeats the perf rationale
    // of using uWS in the first place. Require an explicit opt-in so users
    // discover the tradeoff at boot, not in production under load.
    if (!isLinux && !this._allowUserspaceProxy) {
      throw new Error(
        `[Axiomify/native] listenClustered() requires Linux for SO_REUSEPORT-based ` +
          `clustering. Current platform: ${process.platform}. On non-Linux platforms ` +
          `Axiomify falls back to a userspace TCP proxy that adds two event-loop hops ` +
          `per byte and largely negates uWS's performance advantage. ` +
          `Either deploy on Linux, use listen() for single-process operation, or set ` +
          `allowUserspaceProxy: true on NativeAdapter options to acknowledge this.`,
      );
    }

    // ── Worker Process ───────────────────────────────────────────────────
    if (!cluster.isPrimary) {
      // Linux uses SO_REUSEPORT (same port). Others use distinct sequential ports.
      const assignedPort = isLinux
        ? this._port
        : this._port + 1 + parseInt(process.env.AXIOMIFY_WORKER_IDX || '0', 10);

      this.listen(
        () => {
          opts.onWorkerReady?.();
          process.send?.({
            type: 'WORKER_READY',
            pid: process.pid,
            port: assignedPort,
          });
        },
        undefined,
        assignedPort,
      );

      const heartbeatInterval = setInterval(() => {
        process.send?.({
          type: 'HEARTBEAT',
          pid: process.pid,
        });
      }, 5000);
      heartbeatInterval.unref?.();

      process.once('SIGTERM', () => {
        clearInterval(heartbeatInterval);
        this.close();
        setTimeout(() => {
          console.error(`[Worker ${process.pid}] Drain timeout. Forcing exit.`);
          process.exit(1);
        }, gracefulTimeoutMs).unref();
      });
      return;
    }

    // ── Primary Process ──────────────────────────────────────────────────
    const targetWorkers = Math.min(
      this._workers,
      availableParallelism?.() ?? cpus().length,
    );
    const liveWorkers = new Map<
      number,
      {
        process: cluster.Worker;
        state: string;
        port: number;
        lastHeartbeat: number;
      }
    >();

    let isShuttingDown = false;
    let initialBootComplete = false;
    let l4Proxy: import('node:net').Server | null = null;

    // L4 TCP Proxy (macOS / Windows Only)
    // Reached only when allowUserspaceProxy=true on a non-Linux platform.
    // The platform gate at the top of this method has already enforced opt-in;
    // here we emit a startup warning so the degradation is visible in logs.
    if (!isLinux) {
      this._logger.warn(
        `[Axiomify/native] Userspace L4 TCP proxy is active on port ${this._port} ` +
          `(platform: ${process.platform}). Each request now traverses Node.js twice ` +
          `(primary → worker) — expect a significant throughput reduction vs Linux ` +
          `SO_REUSEPORT clustering. This path is intended for development only.`,
        {
          platform: process.platform,
          port: this._port,
          workers: targetWorkers,
        },
      );

      let rrIndex = 0;
      const net = require('node:net');
      l4Proxy = net.createServer((client: import('node:net').Socket) => {
        const readyWorkers = Array.from(liveWorkers.values()).filter(
          (w) => w.state === 'READY',
        );
        if (readyWorkers.length === 0) return client.destroy();

        const target = readyWorkers[rrIndex++ % readyWorkers.length];

        const backend = net.connect(target.port, '127.0.0.1', () => {
          client.pipe(backend);
          backend.pipe(client);
        });

        client.on('error', () => backend.destroy());
        backend.on('error', () => client.destroy());
      });

      l4Proxy?.listen(this._port);
    }

    const spawnWorker = (idx: number, respawnDelayMs = 0) => {
      const w = cluster.fork({ AXIOMIFY_WORKER_IDX: idx.toString() });
      const pid = w.process.pid!;

      liveWorkers.set(pid, {
        process: w,
        state: 'STARTING',
        port: 0,
        lastHeartbeat: Date.now(),
      });

      // Linux Production Optimization: CPU Pinning
      if (isLinux) {
        try {
          const { execSync } = require('node:child_process');
          execSync(`taskset -cp ${idx % targetWorkers} ${pid}`, {
            stdio: 'ignore',
          });
        } catch (e) {
          /* Fallback */
        }
      }

      w.on('message', (msg: { type?: string; port?: number }) => {
        if (msg?.type === 'HEARTBEAT') {
          const record = liveWorkers.get(pid);
          if (record) {
            record.lastHeartbeat = Date.now();
          }
          return;
        }
        if (msg?.type !== 'WORKER_READY') return;

        const record = liveWorkers.get(pid);
        if (record) {
          record.state = 'READY';
          record.port = msg.port!;
        }

        if (!initialBootComplete && liveWorkers.size === targetWorkers) {
          initialBootComplete = true;
          opts.onPrimary?.(Array.from(liveWorkers.keys()));
        }
      });

      w.on('exit', (code) => {
        const record = liveWorkers.get(pid);
        const wasDraining = record?.state === 'DRAINING';
        liveWorkers.delete(pid);
        opts.onWorkerExit?.(pid, code);

        if (isShuttingDown || wasDraining) return;

        // Let external orchestrators (Kubernetes/systemd) manage crash loops instead of
        // suiciding the primary process. Backoff helps prevent CPU pinning.
        // Exponential backoff with 20% random jitter to prevent thundering herd.
        const baseDelay = Math.min((respawnDelayMs || 50) * 2, 5_000);
        const jitter = Math.floor(Math.random() * (baseDelay * 0.2));
        const nextDelay = baseDelay + (Math.random() > 0.5 ? jitter : -jitter);
        setTimeout(() => spawnWorker(idx, baseDelay), Math.max(0, nextDelay));
      });
      return w;
    };

    // Heartbeat check interval in primary (every 10 seconds)
    const livenessInterval = setInterval(() => {
      if (isShuttingDown) return;
      const now = Date.now();
      for (const [pid, record] of liveWorkers.entries()) {
        if (record.state === 'READY' && now - record.lastHeartbeat > 15_000) {
          this._logger.error(
            `[Axiomify/native] Worker ${pid} missed heartbeats. Event loop might be blocked. Killing worker.`,
            { pid },
          );
          record.process.kill('SIGKILL');
        }
      }
    }, 10_000);
    livenessInterval.unref?.();

    // SYSTEM SHUTDOWN
    process.once('SIGTERM', () => {
      isShuttingDown = true;
      clearInterval(livenessInterval);
      l4Proxy?.close();
      if (liveWorkers.size === 0) process.exit(0);

      for (const [pid, record] of liveWorkers.entries()) {
        record.state = 'DRAINING';
        record.process.kill('SIGTERM');
      }
      setTimeout(() => process.exit(1), gracefulTimeoutMs + 2000).unref();
    });

    // ROLLING RESTART
    process.on('SIGUSR2', () => {
      if (isShuttingDown) return;
      const pids = Array.from(liveWorkers.keys());
      let nextIndex = 0;
      let activeRestarts = 0;

      const replaceNext = () => {
        if (nextIndex >= pids.length) return;

        const currentIdx = nextIndex++;
        activeRestarts++;

        const oldPid = pids[currentIdx];
        const oldRecord = liveWorkers.get(oldPid);

        // Spawn replacement using the same logical index
        const newWorker = spawnWorker(currentIdx, 0);

        const readyListener = (msg: any) => {
          if (msg?.type === 'WORKER_READY') {
            newWorker.removeListener('message', readyListener);
            if (oldRecord) {
              oldRecord.state = 'DRAINING';
              oldRecord.process.kill('SIGTERM');
            }
            activeRestarts--;
            replaceNext();
          }
        };
        newWorker.on('message', readyListener);
      };

      // Start up to _restartParallelism workers concurrently
      for (let p = 0; p < this._restartParallelism; p++) {
        replaceNext();
      }
    });

    for (let i = 0; i < targetWorkers; i++) spawnWorker(i);
  }

  public close(): void {
    if (this._listenSocket) {
      uWS.us_listen_socket_close(this._listenSocket);
      this._listenSocket = null;
    }
  }

  /**
   * Adapter-bridge entry point: hands the underlying `uWS.App` instance to
   * a trusted plugin (e.g. `@axiomify/socket.io`) so it can attach its own
   * routes/upgrades on the same uWS event loop. Authenticated via the
   * shared `ADAPTER_LOCK_TOKEN` from `@axiomify/core/internal` — calling
   * this from user code throws.
   *
   * Plugins that use this MUST call it BEFORE `adapter.listen()`, since
   * uWS does not permit route registration on a listening socket.
   *
   * Hook a graceful-shutdown callback via {@link onShutdown} so the
   * plugin's resources (e.g. open WebSocket connections) close cleanly
   * when the adapter drains.
   *
   * @internal Plugin-author API. Not part of the public Axiomify surface.
   */
  public getRawServer(token: symbol): TemplatedApp {
    if (token !== this._lockToken && token !== ADAPTER_LOCK_TOKEN) {
      throw new Error(
        '[Axiomify/native] getRawServer() is reserved for adapter-bridge plugins. ' +
          'Import ADAPTER_LOCK_TOKEN from @axiomify/core and pass it as the first argument.',
      );
    }
    if (token === ADAPTER_LOCK_TOKEN) {
      const stack = new Error().stack ?? '';
      const authorized =
        stack.includes('packages/socket.io') ||
        stack.includes('@axiomify/socket.io') ||
        stack.includes('socket.io-bridge');
      if (!authorized) {
        throw new Error(
          '[Axiomify/native] getRawServer() is privileged and can only be called by authorized adapters or bridges.',
        );
      }
    }
    return this._server;
  }

  /**
   * Adapter-bridge entry point: register a callback that runs as part of
   * `gracefulShutdown()`'s drain sequence, BEFORE the user-supplied
   * `onShutdown`. Plugins use this to close their own resources (open
   * WebSocket connections, hold-then-release queues, etc).
   *
   * Multiple registrations stack — every callback runs sequentially.
   * Errors from individual callbacks are swallowed and logged, so one
   * misbehaving plugin can't block another's cleanup.
   *
   * @internal Plugin-author API. See {@link getRawServer}.
   */
  private _bridgeShutdownCallbacks: Array<() => void | Promise<void>> = [];
  public registerShutdownCallback(
    token: symbol,
    cb: () => void | Promise<void>,
  ): void {
    if (token !== this._lockToken && token !== ADAPTER_LOCK_TOKEN) {
      throw new Error(
        '[Axiomify/native] registerShutdownCallback() is reserved for adapter-bridge plugins. ' +
          'Import ADAPTER_LOCK_TOKEN from @axiomify/core.',
      );
    }
    if (token === ADAPTER_LOCK_TOKEN) {
      const stack = new Error().stack ?? '';
      const authorized =
        stack.includes('packages/socket.io') ||
        stack.includes('@axiomify/socket.io') ||
        stack.includes('socket.io-bridge');
      if (!authorized) {
        throw new Error(
          '[Axiomify/native] registerShutdownCallback() is privileged and can only be called by authorized adapters or bridges.',
        );
      }
    }
    this._bridgeShutdownCallbacks.push(cb);
  }

  /**
   * Wires SIGINT/SIGTERM to a graceful drain sequence:
   *   1. Stop accepting new connections (close the uWS listen socket).
   *   2. Run the caller-supplied `onShutdown` hook (close DB pools, flush
   *      logger buffers, etc.). It is awaited.
   *   3. `process.exit(0)`.
   * If `onShutdown` throws, exits with code 1.
   * If step 2 doesn't complete within `timeoutMs`, force-exits with code 1.
   *
   * This is the unified shutdown entry point for NativeAdapter. Do NOT call
   * `gracefulShutdown()` from `@axiomify/core` on a NativeAdapter — that
   * helper takes a Node.js `http.Server` and will not understand uWS's
   * listen socket. Use this method instead.
   *
   * @example
   * const adapter = new NativeAdapter(app);
   * adapter.listen();
   * adapter.gracefulShutdown({
   *   onShutdown: async () => { await db.close(); },
   *   timeoutMs: 15_000,
   * });
   */
  public gracefulShutdown(
    options: {
      onShutdown?: () => void | Promise<void>;
      timeoutMs?: number;
    } = {},
  ): void {
    const timeoutMs = options.timeoutMs ?? 10_000;
    this._onShutdown = options.onShutdown ?? (() => {});

    // Detach any signal handlers installed by _installCrashGuard so they
    // don't race the drain sequence below. This makes gracefulShutdown()
    // safe to call either before or after listen().
    for (const { sig, fn } of this._crashSignalHandlers) {
      process.removeListener(sig, fn);
    }
    this._crashSignalHandlers = [];

    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;

      // Force-exit safety net. Unref'd so it never keeps the loop alive
      // on its own. Cleared on clean exit.
      const forceExit = setTimeout(() => {
        this._logger.error(
          '[Axiomify/native] Graceful shutdown timeout exceeded. Forcing exit.',
          { timeoutMs },
        );
        process.exit(1);
      }, timeoutMs);
      forceExit.unref();

      // Stop accepting new connections IMMEDIATELY. uWS's
      // us_listen_socket_close() makes the socket reject SYN packets while
      // already-accepted connections keep serving. This is the fast half of
      // the drain — the slow half is waiting for in-flight requests below.
      this.close();

      try {
        // Wait for the in-flight counter to hit zero before running the
        // caller's onShutdown. Without this, a POST /charge that's writing
        // to the DB at SIGTERM time would have its connection killed by
        // process.exit() — the DB write happens, the response never reaches
        // the client, the client retries, you double-charge.
        //
        // The forceExit timer above is the upper bound: if drain takes
        // longer than timeoutMs we exit 1 regardless. This mirrors
        // Kubernetes' terminationGracePeriodSeconds — the orchestrator
        // assumes draining can take a finite amount of time but not forever.
        await this._waitForDrain();
        if (this._inflight > 0) {
          this._logger.warn(
            '[Axiomify/native] Draining with in-flight requests; ' +
              'waited but the counter is non-zero (likely a long-lived stream).',
            { inflight: this._inflight },
          );
        }
        // Run bridge-plugin shutdown callbacks BEFORE the user-supplied
        // onShutdown. Plugins (e.g. @axiomify/socket.io) close their own
        // connections / drain their own queues here so the user's
        // onShutdown can assume the plugin is quiescent. Errors are
        // swallowed and logged — one misbehaving plugin must not block
        // the rest, and the force-exit timer remains the upper bound.
        for (const cb of this._bridgeShutdownCallbacks) {
          try {
            await cb();
          } catch (err) {
            this._logger.error(
              '[Axiomify/native] Bridge-plugin shutdown callback threw',
              { error: err },
            );
          }
        }
        if (this._onShutdown) await this._onShutdown();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        clearTimeout(forceExit);
        this._logger.error('[Axiomify/native] onShutdown threw', {
          error: err,
        });
        process.exit(1);
      }
    };

    process.once('SIGTERM', () => void drain());
    process.once('SIGINT', () => void drain());
  }
}

export { adaptMiddleware } from './bridge';

/**
 * Internal helpers exposed for unit testing only.
 * Not part of the public API — do not import from application code.
 * @internal
 */
export const __internal = {
  fastParseQuery,
  safeDecodeURIComponent,
};
