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

  it('calls closeAllConnections() when available to drain keep-alive sockets', async () => {
    const mockServer = new EventEmitter() as any;
    mockServer.close = vi.fn((cb: () => void) => cb());
    mockServer.closeAllConnections = vi.fn();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    gracefulShutdown(mockServer, { timeoutMs: 100 });
    process.emit('SIGTERM' as any);

    await new Promise(process.nextTick);

    // closeAllConnections must be called before server.close so keep-alive
    // connections do not prevent the server from stopping.
    const closeAllOrder =
      mockServer.closeAllConnections.mock.invocationCallOrder[0];
    const closeOrder = mockServer.close.mock.invocationCallOrder[0];
    expect(closeAllOrder).toBeLessThan(closeOrder);

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
