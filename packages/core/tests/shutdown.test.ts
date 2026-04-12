import { describe, expect, it, vi } from 'vitest';
import { gracefulShutdown } from '../src/index';
import EventEmitter from 'events';

describe('Graceful Shutdown', () => {
  it('calls server.close and onShutdown', async () => {
    const mockServer = new EventEmitter() as any;
    mockServer.close = vi.fn((cb) => cb());
    
    const onShutdown = vi.fn().mockResolvedValue(undefined);
    
    // Mock process.exit
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    
    gracefulShutdown(mockServer, { onShutdown, timeoutMs: 100 });
    process.emit('SIGTERM' as any);
    
    // Allow promises to resolve
    await new Promise(process.nextTick);
    
    expect(mockServer.close).toHaveBeenCalled();
    expect(onShutdown).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    
    exitSpy.mockRestore();
  });
});
