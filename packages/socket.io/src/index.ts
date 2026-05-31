/**
 * @axiomify/socket.io — bridge Socket.IO 4.4+ onto the same uWebSockets.js
 * server that powers `@axiomify/native`. One listener handles HTTP, native
 * WebSocket routes (`app.ws()`), and Socket.IO — no second Node process,
 * no proxy in front, no port juggling.
 *
 * Architecture
 * ------------
 * Socket.IO 4.4 added native uWS support via `io.attachApp(uwsApp)`. The
 * stock Socket.IO server expects a Node `http.Server` and ignores uWS;
 * this package wires it in correctly:
 *
 *   1. Pull the underlying `uWS.App` instance out of `NativeAdapter`
 *      using the same `ADAPTER_LOCK_TOKEN` gate the adapter uses for its
 *      own internal APIs (so user code can't reach it accidentally).
 *   2. Call `io.attachApp(uwsApp, options)` BEFORE `adapter.listen()`.
 *      Both upgrades (HTTP + Socket.IO) end up on one event loop.
 *   3. Register an adapter shutdown callback so the bridge closes all
 *      Socket.IO connections when the adapter drains.
 *
 * Path collision
 * --------------
 * Socket.IO claims `/socket.io/` by default. If any of your Axiomify
 * routes share that prefix, Socket.IO's upgrade handler will eat them.
 * Either move your routes off `/socket.io/*` or pass a different `path:`
 * option (`io.attachApp` honours the `path` field on its options).
 */
import type { AxiomifyRequest, AxiomifyResponse } from '@axiomify/core';
import { ADAPTER_LOCK_TOKEN, makeSerialize } from '@axiomify/core';
import type { NativeAdapter } from '@axiomify/native';
import type {
  Server as IOServer,
  ServerOptions as IOServerOptions,
  Socket,
} from 'socket.io';

/**
 * Re-export the few Socket.IO types we lean on so consumers can write
 *   `import { attachSocketIO, type Socket } from '@axiomify/socket.io'`
 * without also adding `@types/socket.io` to their devDependencies.
 */
export type { IOServer, Socket };

export interface AttachSocketIOOptions extends Partial<IOServerOptions> {
  /**
   * If true (default), `attachSocketIO` registers a shutdown callback on
   * the adapter so all Socket.IO connections close cleanly when
   * `adapter.gracefulShutdown()` runs. Disable only if you want to manage
   * Socket.IO's lifecycle yourself.
   */
  drainOnAdapterShutdown?: boolean;
  /**
   * Optional callback invoked once the bridge is attached. Useful in
   * tests / structured-startup logs that want to know the IO server is
   * live. Equivalent to subscribing to `io.engine.on('initial_headers')`
   * but fires exactly once.
   */
  onAttached?: (io: IOServer) => void;
}

/**
 * Internal flag — guards against attaching twice to the same adapter.
 * Two Socket.IO servers binding the same `path:` would conflict at the
 * upgrade step; we throw a clear error instead of letting uWS produce a
 * less-obvious one.
 */
const ATTACHED = new WeakSet<NativeAdapter>();

/**
 * Bridge Socket.IO onto the existing NativeAdapter's uWS server.
 *
 * Must be called BEFORE `adapter.listen()`. uWS does not permit route /
 * upgrade registration on a listening socket — we surface that as a
 * clear error rather than letting uWS produce a less-obvious one.
 *
 * @example
 *   import { Axiomify } from '@axiomify/core';
 *   import { NativeAdapter } from '@axiomify/native';
 *   import { attachSocketIO } from '@axiomify/socket.io';
 *
 *   const app = new Axiomify();
 *   app.route({ method: 'GET', path: '/ping', handler: (_, res) => res.send({ ok: true }) });
 *
 *   const adapter = new NativeAdapter(app, { port: 3000 });
 *
 *   const io = attachSocketIO(adapter, {
 *     cors: { origin: 'https://app.example.com' },
 *   });
 *
 *   io.on('connection', (socket) => {
 *     socket.emit('hello', { msg: 'world' });
 *     socket.on('chat', (data) => io.emit('chat', data));
 *   });
 *
 *   adapter.listen();  // single listener handles HTTP + Socket.IO
 */
export async function attachSocketIO(
  adapter: NativeAdapter,
  options: AttachSocketIOOptions = {},
): Promise<IOServer> {
  if (ATTACHED.has(adapter)) {
    throw new Error(
      '[axiomify/socketio] attachSocketIO() was already called on this adapter. ' +
        'Only one Socket.IO server can be attached per NativeAdapter — multiple ' +
        'IO instances would collide at the WebSocket upgrade step. If you need ' +
        'multiple Socket.IO namespaces, use `io.of(name)` on the single attached server.',
    );
  }

  // Dynamic import so projects that don't use this bridge never pay the
  // socket.io install cost during static analysis. Async also makes the
  // function vitest-mock-friendly (vi.mock intercepts `await import()`
  // but not `require()` of CJS dependencies). The `await` at the call
  // site is one-shot, at startup — no per-request cost.
  let Server: typeof IOServer;
  try {
    const mod = (await import('socket.io')) as unknown as {
      Server: typeof IOServer;
      default?: { Server: typeof IOServer };
    };
    // socket.io's published shape is CJS-with-named-exports; under
    // vitest's ESM interop the named export sometimes lands under
    // `default`. Probe both so the import works in dev + prod + tests.
    Server =
      mod.Server ?? mod.default?.Server ?? (mod as unknown as typeof IOServer);
    if (typeof Server !== 'function') {
      throw new Error('socket.io module did not expose a Server constructor');
    }
  } catch (err) {
    throw new Error(
      '[axiomify/socketio] `socket.io` is a required peer dependency and was not found. ' +
        'Install it with `npm install socket.io` (≥ 4.4.0 — earlier versions lack uWS support). ' +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  // Pull the underlying uWS app via the token-gated NativeAdapter API.
  // If `adapter.listen()` already ran, uWS will refuse the attachApp call
  // — we'd rather throw here with a clearer message.
  const uwsApp = adapter.getRawServer(ADAPTER_LOCK_TOKEN);

  const { drainOnAdapterShutdown = true, onAttached, ...ioOptions } = options;

  const io: IOServer = new Server(ioOptions);

  // Socket.IO 4.4+ provides `attachApp` specifically for uWS integration.
  // It registers the upgrade handler under `options.path` (default
  // `/socket.io/`) and shares the event loop with our HTTP routes.
  io.attachApp(uwsApp as any);

  // Register a shutdown callback so the adapter's drain sequence closes
  // open Socket.IO connections before `process.exit()`. Without this,
  // long-lived clients would have their TCP connections cut at the OS
  // level rather than seeing a proper `disconnect` frame.
  if (drainOnAdapterShutdown) {
    adapter.registerShutdownCallback(ADAPTER_LOCK_TOKEN, async () => {
      // `io.close()` accepts a callback; we promisify so the adapter's
      // drain `await` actually waits. Per the Socket.IO docs, `close`
      // disconnects all clients and stops accepting new connections.
      await new Promise<void>((resolve, reject) => {
        try {
          io.close((err?: Error) => (err ? reject(err) : resolve()));
        } catch (err) {
          // Some Socket.IO versions don't call back synchronously on error
          // paths; the try/catch covers the synchronous-throw case.
          reject(err);
        }
      });
    });
  }

  ATTACHED.add(adapter);
  onAttached?.(io);
  return io;
}

/**
 * Wrap an Axiomify `RouteMiddleware` so it can run as Socket.IO middleware
 * (`io.use(...)`). The Axiomify plugin's `req` is reconstructed from the
 * Socket.IO handshake — headers, query, ip, etc. — so existing auth /
 * rate-limit / fingerprint plugins work for connection upgrades without
 * being rewritten.
 *
 * What the bridge surfaces to the Axiomify plugin:
 *   - `req.headers`        from `socket.handshake.headers`
 *   - `req.query`          from `socket.handshake.query`
 *   - `req.url` / `req.path` from `socket.handshake.url` / `socket.nsp.name`
 *   - `req.ip`             from `socket.handshake.address`
 *   - `req.method`         always `'GET'` (Socket.IO upgrades are GETs)
 *   - `req.body`           empty (no body on the upgrade handshake)
 *   - `req.state`          shared back to `socket.data` on success
 *   - `res.status(code).send(_, message)` rejects the connection
 *
 * If the plugin calls `res.send()` / `res.status()` with a 4xx-5xx,
 * Socket.IO's `next(err)` is invoked and the connection is refused.
 * Plugins that don't touch the response (the auth-success path) let
 * `next()` proceed and the socket connects normally.
 *
 * @example
 *   import { createAuthPlugin } from '@axiomify/auth';
 *   const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });
 *   io.use(adaptAxiomifyPlugin(requireAuth));
 *
 *   io.on('connection', (socket) => {
 *     // socket.data.user is whatever the auth plugin stuffed onto req.state.user
 *   });
 */
export type AxiomifyRouteMiddleware = (
  req: AxiomifyRequest,
  res: AxiomifyResponse,
) => void | Promise<void>;

export function adaptAxiomifyPlugin(
  plugin: AxiomifyRouteMiddleware,
): (socket: Socket, next: (err?: Error) => void) => void {
  return (socket: Socket, next: (err?: Error) => void) => {
    const handshake = socket.handshake;
    const controller = new AbortController();

    const disconnectHandler = () => {
      controller.abort(new Error('Socket disconnected'));
    };
    if (typeof socket.once === 'function') {
      socket.once('disconnect', disconnectHandler);
    }

    // Pseudo-request constructed from the Socket.IO handshake. The
    // surface mirrors what Axiomify route plugins read from the real
    // `NativeRequest` — anything they touch beyond this is undefined,
    // and that's a deliberate signal that an HTTP-only field doesn't
    // apply to a socket upgrade.
    const req: AxiomifyRequest = {
      id: socket.id,
      method: 'GET',
      url: handshake.url,
      path: socket.nsp.name,
      ip: handshake.address,
      headers: handshake.headers as Record<
        string,
        string | string[] | undefined
      >,
      body: undefined,
      query: handshake.query as Record<string, string | string[]>,
      params: {},
      state: {},
      // The real adapter exposes `raw: { req, res }`; here we surface the
      // socket so escape hatches still work for socket.io-specific needs.
      raw: { socket } as unknown,
      stream: undefined as never, // no request stream on an upgrade
      signal: controller.signal,
    } as unknown as AxiomifyRequest;

    let rejected: { code: number; message?: string } | null = null;

    // Inline pseudo-response. Typed as `MockRes` so TS can resolve `this`
    // bindings on each method; the final cast to `AxiomifyResponse` is
    // the boundary contract — the framework only exercises a subset.
    interface MockRes {
      statusCode: number;
      headersSent: boolean;
      isStreaming: boolean;
      onStreamClose: (() => void) | null;
      raw: unknown;
      capabilities: { sse: boolean; streaming: boolean };
      status(code: number): MockRes;
      header(): MockRes;
      getHeader(): string | undefined;
      removeHeader(): MockRes;
      send(data: unknown, message?: string): void;
      sendRaw(payload: unknown): void;
      stream(): void;
    }
    const res: MockRes = {
      statusCode: 200,
      headersSent: false,
      isStreaming: false,
      onStreamClose: null,
      raw: {},
      capabilities: { sse: false, streaming: false },
      status(code: number): MockRes {
        this.statusCode = code;
        return this;
      },
      header(): MockRes {
        // Headers don't apply to a Socket.IO middleware accept/reject. No-op
        // is safer than throwing — plugins commonly add caching headers
        // unconditionally that we'd otherwise have to allow-list.
        return this;
      },
      getHeader: () => undefined,
      removeHeader(): MockRes {
        return this;
      },
      send(_data: unknown, message?: string): void {
        rejected = { code: this.statusCode, message };
        this.headersSent = true;
      },
      sendRaw(_payload: unknown): void {
        rejected = { code: this.statusCode };
        this.headersSent = true;
      },
      stream(): void {
        // Streaming responses make no sense for a Socket.IO upgrade. Fail
        // loudly rather than silently no-op so plugins that try to stream
        // here get a clear signal.
        throw new Error(
          '[axiomify/socketio] Streaming responses cannot be used inside an ' +
            'io.use() middleware. Reject the connection with res.status(code).send(null, msg) instead.',
        );
      },
    };
    const axRes = res as unknown as AxiomifyResponse;

    Promise.resolve()
      .then(() => plugin(req, axRes))
      .then(() => {
        if (rejected) {
          if (typeof socket.off === 'function') {
            socket.off('disconnect', disconnectHandler);
          }
          const code = rejected.code;
          const msg = rejected.message ?? `Connection refused (status ${code})`;
          // Socket.IO middleware uses Error with `data` for transport;
          // attach status code so client-side socket.on('connect_error')
          // can inspect it.
          const err = Object.assign(new Error(msg), {
            data: { statusCode: code, message: msg },
          });
          next(err);
          return;
        }
        // Hand any `req.state` set by the plugin back to `socket.data`
        // — the convention every existing Socket.IO middleware uses.
        Object.assign(socket.data, req.state);
        next();
      })
      .catch((err) => {
        if (typeof socket.off === 'function') {
          socket.off('disconnect', disconnectHandler);
        }
        next(err instanceof Error ? err : new Error(String(err)));
      });
  };
}

// Re-export the serializer helper so plugins that explicitly want to format
// their refused-connection messages with the same envelope shape as
// regular HTTP responses can do so. Most plugins don't need this; we
// re-export so the import path is consistent.
export { makeSerialize };
