import { describe, expect, it, vi } from 'vitest';
import { WsManager } from '../src/index';

describe('WsManager generics and auth flow', () => {
  it('stores typed user on upgraded client', async () => {
    let upgradeHandler: any;
    const server = {
      on: vi.fn((event, handler) => {
        if (event === 'upgrade') upgradeHandler = handler;
      }),
    } as any;

    type User = { id: string; role: 'admin' | 'user' };
    const manager = new WsManager<User>({
      server,
      heartbeatIntervalMs: 0,
      authenticate: async () => ({ id: 'u1', role: 'admin' }),
    });

    const fakeSocket = { write: vi.fn(), destroy: vi.fn() } as any;
    vi.spyOn((manager as any).wss, 'handleUpgrade').mockImplementation(
      (_req: any, _socket: any, _head: any, cb: any) => {
        const ws = { on: vi.fn(), readyState: 1 } as any;
        cb(ws);
      },
    );

    await upgradeHandler({ url: '/' }, fakeSocket, Buffer.alloc(0));
    const stats = manager.getStats();
    expect(stats.connectedClients).toBe(1);
  });
});
