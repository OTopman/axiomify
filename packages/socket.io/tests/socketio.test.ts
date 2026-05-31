/**
 * Unit tests for @axiomify/socket.io.
 *
 * Socket.IO and uWS are mocked at the module level so these tests run on
 * every Node version we support, not just the Linux + Node 22 combo
 * where uWS prebuilts exist. The mock surface is small — enough to
 * verify our bridge wires `attachApp` correctly, registers a shutdown
 * callback, and translates Axiomify route plugins into Socket.IO
 * middleware faithfully. End-to-end socket connection tests belong in a
 * dedicated integration suite.
 *
 * IMPORTANT: vi.mock calls MUST be at module top level (hoisted) and
 * imports of the system-under-test MUST be static, not dynamic. Dynamic
 * `await import(...)` from inside individual `it()` blocks loses the
 * mock interception in vitest 3.x — the spy chains we depend on lose
 * track of `Server` between tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── uWS mock ────────────────────────────────────────────────────────────
vi.mock('uWebSockets.js', () => ({
  default: {
    App: () => ({
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      options: vi.fn(),
      head: vi.fn(),
      any: vi.fn(),
      ws: vi.fn(),
      listen: vi.fn((_p: number, cb: (t: unknown) => void) => cb({})),
    }),
    SHARED_COMPRESSOR: 0,
    us_listen_socket_close: vi.fn(),
    us_socket_local_port: vi.fn(() => 3000),
  },
}));

// ─── socket.io mock ──────────────────────────────────────────────────────
// Names starting with `mock` are allowed inside vi.mock factories — that's
// the documented escape hatch. Every instance the bridge constructs gets
// these same vi.fn() spies, so assertions across tests stay coherent.
const mockAttachApp = vi.fn();
const mockClose = vi.fn((cb: (err?: Error) => void) => cb());
const mockUse = vi.fn();
const mockOn = vi.fn();

vi.mock('socket.io', () => {
  class FakeServer {
    opts: Record<string, unknown>;
    attachApp = mockAttachApp;
    close = mockClose;
    use = mockUse;
    on = mockOn;
    emit = vi.fn();
    constructor(opts: Record<string, unknown> = {}) {
      this.opts = opts;
    }
  }
  return { Server: FakeServer };
});

// Static imports AFTER vi.mock — vitest hoists vi.mock above these.
import { ADAPTER_LOCK_TOKEN, Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { adaptAxiomifyPlugin, attachSocketIO } from '../src/index';

beforeEach(() => {
  mockAttachApp.mockClear();
  mockClose.mockClear();
  mockUse.mockClear();
  mockOn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachSocketIO', () => {
  it('attaches socket.io to the underlying uWS app via attachApp()', async () => {
    const app = new Axiomify();
    const adapter = new NativeAdapter(app, { port: 0 });
    const io = await attachSocketIO(adapter, { cors: { origin: '*' } });

    expect(io).toBeDefined();
    expect(mockAttachApp).toHaveBeenCalledOnce();
    // The argument must be the same uWS app the adapter holds — the
    // bridge cannot create its own; that's the whole point.
    const [passedApp] = mockAttachApp.mock.calls[0];
    expect(passedApp).toBe(adapter.getRawServer(ADAPTER_LOCK_TOKEN));
  });

  it('forwards Server options minus our extensions to socket.io constructor', async () => {
    const app = new Axiomify();
    const adapter = new NativeAdapter(app, { port: 0 });
    const io = await attachSocketIO(adapter, {
      cors: { origin: 'https://example.com' },
      path: '/socket.io/',
      drainOnAdapterShutdown: false, // OUR extension; must not reach socket.io
    });

    const opts = (io as unknown as { opts: Record<string, unknown> }).opts;
    expect(opts.cors).toEqual({ origin: 'https://example.com' });
    expect(opts.path).toBe('/socket.io/');
    // OUR-only fields must be stripped before reaching the IO Server.
    expect(opts.drainOnAdapterShutdown).toBeUndefined();
    // `onAttached` is also our extension — also stripped.
    expect(opts.onAttached).toBeUndefined();
  });

  it('fires the onAttached callback exactly once with the IO instance', async () => {
    const onAttached = vi.fn();
    const app = new Axiomify();
    const adapter = new NativeAdapter(app, { port: 0 });
    const io = await attachSocketIO(adapter, { onAttached });

    expect(onAttached).toHaveBeenCalledOnce();
    expect(onAttached).toHaveBeenCalledWith(io);
  });

  it('refuses to attach twice to the same adapter', async () => {
    const app = new Axiomify();
    const adapter = new NativeAdapter(app, { port: 0 });
    await attachSocketIO(adapter);
    // The duplicate-attach check throws synchronously BEFORE awaiting
    // the dynamic import, so we capture the rejected promise.
    await expect(attachSocketIO(adapter)).rejects.toThrow(
      /already called on this adapter/,
    );
  });

  it('separate adapters can each have their own Socket.IO bridge', async () => {
    const a = new NativeAdapter(new Axiomify(), { port: 0 });
    const b = new NativeAdapter(new Axiomify(), { port: 0 });
    await attachSocketIO(a);
    await attachSocketIO(b);
    expect(mockAttachApp).toHaveBeenCalledTimes(2);
  });
});

describe('attachSocketIO — graceful shutdown', () => {
  it("closes the IO server when the adapter's bridge-shutdown callback fires", async () => {
    const app = new Axiomify();
    const adapter = new NativeAdapter(app, { port: 0 });
    await attachSocketIO(adapter);

    // Trigger the registered shutdown callback directly so we don't have
    // to fake SIGTERM / process.exit. Access via documented private state.
    const callbacks = (
      adapter as unknown as {
        _bridgeShutdownCallbacks: Array<() => Promise<void> | void>;
      }
    )._bridgeShutdownCallbacks;
    expect(callbacks).toHaveLength(1);
    await callbacks[0]();
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('skips shutdown callback registration when drainOnAdapterShutdown: false', async () => {
    const app = new Axiomify();
    const adapter = new NativeAdapter(app, { port: 0 });
    await attachSocketIO(adapter, { drainOnAdapterShutdown: false });

    const callbacks = (
      adapter as unknown as {
        _bridgeShutdownCallbacks: Array<() => Promise<void> | void>;
      }
    )._bridgeShutdownCallbacks;
    expect(callbacks).toHaveLength(0);
  });
});

describe('adaptAxiomifyPlugin', () => {
  function makeSocket(overrides: Record<string, unknown> = {}): any {
    const { EventEmitter } = require('node:events');
    const emitter = new EventEmitter();
    const sock = {
      id: 'sock-1',
      nsp: { name: '/' },
      data: {},
      handshake: {
        url: '/socket.io/?EIO=4',
        address: '127.0.0.1',
        headers: { authorization: 'Bearer token' },
        query: { EIO: '4' },
        ...((overrides as { handshake?: Record<string, unknown> }).handshake ??
          {}),
      },
      once: emitter.once.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      on: emitter.on.bind(emitter),
      listenerCount: emitter.listenerCount.bind(emitter),
      ...overrides,
    };
    return sock;
  }

  it('calls next() with no error when the plugin does not touch res', async () => {
    const plugin = vi.fn(async () => {});
    const middleware = adaptAxiomifyPlugin(plugin);
    const next = vi.fn();
    middleware(makeSocket(), next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with an Error carrying status code when plugin calls res.status(401).send(null, "...")', async () => {
    const plugin = vi.fn(async (_req: unknown, res: any) => {
      res.status(401).send(null, 'Unauthorized');
    });
    const middleware = adaptAxiomifyPlugin(plugin);
    const next = vi.fn();
    middleware(makeSocket(), next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledOnce();
    const [err] = next.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Unauthorized');
    expect(
      (err as Error & { data: { statusCode: number } }).data.statusCode,
    ).toBe(401);
  });

  it('hands req.state values back to socket.data on success', async () => {
    const plugin = vi.fn(async (req: any) => {
      req.state.user = { id: 'u1', roles: ['admin'] };
    });
    const middleware = adaptAxiomifyPlugin(plugin);
    const socket = makeSocket();
    const next = vi.fn();
    middleware(socket, next);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(); // no error
    expect(socket.data.user).toEqual({ id: 'u1', roles: ['admin'] });
  });

  it('translates a thrown plugin into next(err)', async () => {
    const plugin = vi.fn(async () => {
      throw new Error('plugin exploded');
    });
    const middleware = adaptAxiomifyPlugin(plugin);
    const next = vi.fn();
    middleware(makeSocket(), next);
    await new Promise((r) => setImmediate(r));
    const [err] = next.mock.calls[0];
    expect((err as Error).message).toBe('plugin exploded');
  });

  it('throws if a plugin calls res.stream() — streams have no meaning on a Socket.IO upgrade', async () => {
    const plugin = vi.fn(async (_req: unknown, res: any) => {
      res.stream();
    });
    const middleware = adaptAxiomifyPlugin(plugin);
    const next = vi.fn();
    middleware(makeSocket(), next);
    await new Promise((r) => setImmediate(r));
    const [err] = next.mock.calls[0];
    expect((err as Error).message).toMatch(
      /Streaming responses cannot be used inside an io\.use/,
    );
  });

  it('exposes req.signal (AbortSignal) and aborts it on socket disconnect', async () => {
    let capturedSignal: AbortSignal | undefined;
    const plugin = vi.fn(async (req: any) => {
      capturedSignal = req.signal;
    });
    const middleware = adaptAxiomifyPlugin(plugin);
    const socket = makeSocket();
    const next = vi.fn();
    middleware(socket, next);
    await new Promise((r) => setImmediate(r));

    expect(next).toHaveBeenCalledWith();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Trigger disconnect
    socket.emit('disconnect');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('removes disconnect listener if the connection is rejected or throws an error', async () => {
    // 1. Rejected connection
    const rejectPlugin = vi.fn(async (_req: unknown, res: any) => {
      res.status(401).send(null, 'Unauthorized');
    });
    const middleware1 = adaptAxiomifyPlugin(rejectPlugin);
    const socket1 = makeSocket();
    const next1 = vi.fn();
    middleware1(socket1, next1);
    await new Promise((r) => setImmediate(r));
    expect(next1).toHaveBeenCalled();
    expect(socket1.listenerCount('disconnect')).toBe(0);

    // 2. Thrown error
    const throwPlugin = vi.fn(async () => {
      throw new Error('boom');
    });
    const middleware2 = adaptAxiomifyPlugin(throwPlugin);
    const socket2 = makeSocket();
    const next2 = vi.fn();
    middleware2(socket2, next2);
    await new Promise((r) => setImmediate(r));
    expect(next2).toHaveBeenCalled();
    expect(socket2.listenerCount('disconnect')).toBe(0);
  });
});
