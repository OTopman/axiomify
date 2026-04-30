import { describe, expect, it, vi } from 'vitest';
import { gracefulShutdown } from '../src/index';
import EventEmitter from 'events';

describe('gracefulShutdown', () => {
  it('calls server.close and onShutdown, then exits with 0', async () => {
    const mockServer = new EventEmitter() as any;
    mockServer.close = vi.fn((cb: () => void) => cb());
    mockServer.closeAllConnections = vi.fn();

    const onShutdown = vi.fn().mockResolvedValue(undefined);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    gracefulShutdown(mockServer, { onShutdown, timeoutMs: 100 });
    process.emit('SIGTERM' as any);

    await new Promise(process.nextTick);

    expect(mockServer.close).toHaveBeenCalled();
    expect(onShutdown).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });

  it('closes idle keep-alive sockets after stopping new connections', async () => {
    const mockServer = new EventEmitter() as any;
    mockServer.close = vi.fn((cb: () => void) => cb());
    mockServer.closeAllConnections = vi.fn();
    mockServer.closeIdleConnections = vi.fn();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    gracefulShutdown(mockServer, { timeoutMs: 100 });
    process.emit('SIGTERM' as any);

    await new Promise(process.nextTick);

    // Active requests should be allowed to drain. Only idle keep-alive
    // sockets are closed after server.close() starts refusing new work.
    const closeIdleOrder =
      mockServer.closeIdleConnections.mock.invocationCallOrder[0];
    const closeOrder = mockServer.close.mock.invocationCallOrder[0];
    expect(closeOrder).toBeLessThan(closeIdleOrder);
    expect(mockServer.closeAllConnections).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('does not throw when closeAllConnections is absent (Node < 18.2)', async () => {
    const mockServer = new EventEmitter() as any;
    mockServer.close = vi.fn((cb: () => void) => cb());
    // No closeAllConnections — simulates Node 18.0 / 18.1

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    expect(() => {
      gracefulShutdown(mockServer, { timeoutMs: 100 });
      process.emit('SIGTERM' as any);
    }).not.toThrow();

    await new Promise(process.nextTick);
    exitSpy.mockRestore();
  });

  it('exits with 1 when server.close returns an error', async () => {
    const mockServer = new EventEmitter() as any;
    mockServer.close = vi.fn((cb: (err: Error) => void) =>
      cb(new Error('close failed')),
    );
    mockServer.closeAllConnections = vi.fn();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    gracefulShutdown(mockServer, { timeoutMs: 100 });
    process.emit('SIGTERM' as any);

    await new Promise(process.nextTick);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
