import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/app';
import { HookManager } from '../src/lifecycle';

describe('Unified HookEngine Lifecycle', () => {
  it('executes hooks in the correct order: Request → PreHandler → Handler → PostHandler', async () => {
    const app = new Axiomify();
    const executionOrder: string[] = [];

    app.addHook('onRequest', async () => {
      executionOrder.push('onRequest');
    });
    app.addHook('onPreHandler', async () => {
      executionOrder.push('onPreHandler');
    });
    app.addHook('onPostHandler', async () => {
      executionOrder.push('onPostHandler');
    });

    app.route({
      method: 'GET',
      path: '/lifecycle',
      handler: async (_req, res) => {
        executionOrder.push('handler');
        res.status(200).send('ok');
      },
    });

    const mockReq = {
      method: 'GET',
      path: '/lifecycle',
      params: {},
      id: 'test-req',
      state: {},
    } as any;
    const mockRes = {
      status: () => mockRes,
      send: () => {},
      header: () => mockRes,
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);

    expect(executionOrder).toEqual([
      'onRequest',
      'onPreHandler',
      'handler',
      'onPostHandler',
    ]);
  });

  it('catches handler errors and dispatches to onError', async () => {
    const app = new Axiomify();
    let errorCaught = false;

    app.addHook('onError', async (err: unknown) => {
      errorCaught = true;
      expect((err as Error).message).toBe('Business Logic Failed');
    });

    app.route({
      method: 'GET',
      path: '/error',
      handler: async () => {
        throw new Error('Business Logic Failed');
      },
    });

    const mockReq = {
      method: 'GET',
      path: '/error',
      params: {},
      id: 'test-req',
      state: {},
    } as any;
    const mockRes = {
      status: () => mockRes,
      send: () => {},
      header: () => mockRes,
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);
    expect(errorCaught).toBe(true);
  });
});

// ─── HookManager unit tests ───────────────────────────────────────────────────

describe('HookManager', () => {
  describe('run()', () => {
    it('executes all hooks of the given type in registration order', async () => {
      const manager = new HookManager();
      const order: number[] = [];

      manager.add('onRequest', async () => {
        order.push(1);
      });
      manager.add('onRequest', async () => {
        order.push(2);
      });
      manager.add('onRequest', async () => {
        order.push(3);
      });

      await manager.run('onRequest', {} as any, {} as any);
      expect(order).toEqual([1, 2, 3]);
    });

    it('returns undefined (synchronously) when no hooks are registered', () => {
      const manager = new HookManager();
      const result = manager.run('onRequest', {} as any, {} as any);
      expect(result).toBeUndefined();
    });

    it('propagates errors thrown by hooks', async () => {
      const manager = new HookManager();
      manager.add('onRequest', async () => {
        throw new Error('hook error');
      });

      await expect(
        manager.run('onRequest', {} as any, {} as any),
      ).rejects.toThrow('hook error');
    });
  });

  describe('runSafe()', () => {
    it('runs all hooks even when one throws', async () => {
      const manager = new HookManager();
      const order: number[] = [];
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      manager.add('onError', async () => {
        order.push(1);
        throw new Error('boom');
      });
      manager.add('onError', async () => {
        order.push(2);
      });

      await manager.runSafe(
        'onError',
        new Error('original'),
        {} as any,
        {} as any,
      );

      expect(order).toEqual([1, 2]);
      consoleSpy.mockRestore();
    });

    it('logs the caught error to console.error', async () => {
      const manager = new HookManager();
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      manager.add('onError', async () => {
        throw new Error('logged error');
      });

      await manager.runSafe(
        'onError',
        new Error('trigger'),
        {} as any,
        {} as any,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('onError'),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('resolves without throwing when all hooks succeed', async () => {
      const manager = new HookManager();
      manager.add('onClose', async () => {});
      manager.add('onClose', async () => {});

      await expect(
        manager.runSafe('onClose', {} as any, {} as any),
      ).resolves.not.toThrow();
    });

    it('resolves without throwing when no hooks are registered', async () => {
      const manager = new HookManager();
      await expect(
        manager.runSafe('onError', new Error('x'), {} as any, {} as any),
      ).resolves.not.toThrow();
    });
  });
});
