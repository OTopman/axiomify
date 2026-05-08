import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { gracefulShutdown } from '../src/shutdown';

function makeFakeServer() {
  const emitter = new EventEmitter();
  let closeCallback: ((err?: Error) => void) | null = null;
  const server = Object.assign(emitter, {
    close: vi.fn((cb?: (err?: Error) => void) => { closeCallback = cb ?? null; }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
    listening: true,
    triggerClose: (err?: Error) => closeCallback?.(err),
  });
  return server;
}

describe('gracefulShutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.useRealTimers();
    // remove any lingering SIGTERM/SIGINT listeners
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('registers SIGTERM and SIGINT listeners', () => {
    const server = makeFakeServer();
    const before = process.listenerCount('SIGTERM');
    gracefulShutdown(server as any);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
  });

  it('on SIGTERM closes server and calls process.exit(0)', async () => {
    const server = makeFakeServer();
    gracefulShutdown(server as any);
    process.emit('SIGTERM');
    await Promise.resolve();
    server.triggerClose();
    await Promise.resolve();
    expect(server.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('closes idle connections after initiating close', async () => {
    const server = makeFakeServer();
    gracefulShutdown(server as any);
    process.emit('SIGTERM');
    await Promise.resolve();
    expect(server.closeIdleConnections).toHaveBeenCalled();
  });

  it('on close error calls process.exit(1)', async () => {
    const server = makeFakeServer();
    gracefulShutdown(server as any);
    process.emit('SIGTERM');
    await Promise.resolve();
    server.triggerClose(new Error('close failed'));
    await Promise.resolve();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls onShutdown callback before exit(0)', async () => {
    const server = makeFakeServer();
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    gracefulShutdown(server as any, { onShutdown });
    process.emit('SIGTERM');
    await Promise.resolve();
    server.triggerClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onShutdown).toHaveBeenCalled();
  });

  it('replaces existing listeners when called twice on same server', () => {
    const server = makeFakeServer();
    const before = process.listenerCount('SIGTERM');
    gracefulShutdown(server as any);
    gracefulShutdown(server as any);
    // should still be +1 total (replaced, not stacked)
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
  });

  it('ignores repeated signals (draining guard)', async () => {
    const server = makeFakeServer();
    gracefulShutdown(server as any);
    process.emit('SIGTERM');
    process.emit('SIGTERM');
    await Promise.resolve();
    // close() called only once even though SIGTERM fired twice
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});

describe('gracefulShutdown — onShutdown error path', () => {
  let localExitSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });
  afterEach(() => {
    localExitSpy.mockRestore();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('exits(1) when onShutdown callback throws', async () => {
    const server = makeFakeServer();
    gracefulShutdown(server as any, {
      onShutdown: async () => { throw new Error('shutdown error'); },
    });
    process.emit('SIGTERM');
    await Promise.resolve();
    server.triggerClose();
    // Wait for async onShutdown to reject
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(localExitSpy).toHaveBeenCalledWith(1);
  });
});
