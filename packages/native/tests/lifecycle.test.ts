/**
 * NativeAdapter lifecycle tests — gracefulShutdown, allowUserspaceProxy gate,
 * crash-guard signal handler hand-off.
 *
 * These tests mock `uWebSockets.js` so they run on every platform / Node
 * version, including environments where the uWS prebuilt binary doesn't
 * load (e.g. Node 23 on macOS). The real end-to-end uWS integration tests
 * live in `native.test.ts` and run wherever the binary is available.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock uWebSockets.js before the adapter is imported.
vi.mock('uWebSockets.js', () => {
  // Minimal stub of the uWS surface the adapter touches at construction time.
  // Method handlers are no-ops because lifecycle tests never make HTTP calls.
  const makeFakeApp = () => ({
    get: vi.fn().mockReturnThis(),
    post: vi.fn().mockReturnThis(),
    put: vi.fn().mockReturnThis(),
    patch: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    options: vi.fn().mockReturnThis(),
    head: vi.fn().mockReturnThis(),
    any: vi.fn().mockReturnThis(),
    ws: vi.fn().mockReturnThis(),
    listen: vi.fn(
      (_host: string, _port: number, cb: (token: unknown) => void) =>
        cb({ fakeSocket: true }),
    ),
  });
  return {
    default: {
      App: vi.fn(makeFakeApp),
      SHARED_COMPRESSOR: 0,
      us_listen_socket_close: vi.fn(),
      us_socket_local_port: vi.fn(() => 3000),
    },
  };
});

describe('NativeAdapter — allowUserspaceProxy gate', () => {
  let platformDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.restoreAllMocks();
  });

  const stubPlatform = (p: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', {
      value: p,
      configurable: true,
    });
  };

  it('throws on macOS when allowUserspaceProxy is omitted', async () => {
    stubPlatform('darwin');
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    // Use a guarded primary-only call so we don't actually fork.
    expect(() => adapter.listenClustered({})).toThrow(
      /listenClustered\(\) requires Linux/,
    );
  });

  it('throws on Windows when allowUserspaceProxy is omitted', async () => {
    stubPlatform('win32');
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    expect(() => adapter.listenClustered({})).toThrow(/Linux/);
  });

  it('throw message mentions allowUserspaceProxy: true as the opt-in', async () => {
    stubPlatform('darwin');
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    expect(() => adapter.listenClustered({})).toThrow(
      /allowUserspaceProxy: true/,
    );
  });

  // We can't easily test the !isLinux + allowUserspaceProxy=true path without
  // spawning real worker processes — listenClustered() calls cluster.fork()
  // immediately after the gate. The gate itself (above) is what the user-
  // visible contract is, so that's what's verified here.
});

describe('NativeAdapter — gracefulShutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('exit');
    vi.useRealTimers();
  });

  it('registers SIGTERM and SIGINT handlers', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    const before = process.listenerCount('SIGTERM');
    adapter.gracefulShutdown({ onShutdown: async () => {} });
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBeGreaterThanOrEqual(1);
  });

  it('runs onShutdown and exits(0) on SIGTERM', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    adapter.gracefulShutdown({ onShutdown, timeoutMs: 5_000 });

    process.emit('SIGTERM');
    // drain is async (awaits onShutdown). Wait for microtasks to settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(onShutdown).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits(1) when onShutdown throws', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    const logger = { warn: vi.fn(), error: vi.fn() };
    const adapter2 = new NativeAdapter(new Axiomify(), { port: 0, logger });
    adapter2.gracefulShutdown({
      onShutdown: async () => {
        throw new Error('drain failed');
      },
      timeoutMs: 5_000,
    });

    process.emit('SIGTERM');
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('onShutdown threw'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    // Mark adapter as used so the linter doesn't flag the construction-only ref.
    void adapter;
  });

  it('force-exits(1) when onShutdown exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });

    let resolveShutdown!: () => void;
    const onShutdown = () =>
      new Promise<void>((r) => {
        resolveShutdown = r;
      });
    adapter.gracefulShutdown({ onShutdown, timeoutMs: 2_000 });

    process.emit('SIGTERM');
    // Run microtasks so drain() entered onShutdown.
    await Promise.resolve();
    await Promise.resolve();

    // Trip the force-exit timer.
    vi.advanceTimersByTime(2_001);
    expect(exitSpy).toHaveBeenCalledWith(1);

    // Release the dangling Promise so it doesn't leak across tests.
    resolveShutdown();
  });

  it('repeated signals are deduped (drain runs once)', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    adapter.gracefulShutdown({ onShutdown });

    process.emit('SIGTERM');
    process.emit('SIGTERM');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it('detaches crash-guard signal handlers when called after listen()', async () => {
    const { Axiomify } = await import('@axiomify/core');
    const { NativeAdapter } = await import('../src/index');
    const adapter = new NativeAdapter(new Axiomify(), { port: 0 });
    // listen() installs the crash guard (1 SIGTERM listener).
    adapter.listen();
    const afterListen = process.listenerCount('SIGTERM');
    expect(afterListen).toBeGreaterThanOrEqual(1);

    // gracefulShutdown should remove the crash-guard listener and install
    // its own — net count stays the same, but only ONE drain fires per signal.
    adapter.gracefulShutdown({ onShutdown: async () => {} });
    expect(process.listenerCount('SIGTERM')).toBe(afterListen);
  });
});
