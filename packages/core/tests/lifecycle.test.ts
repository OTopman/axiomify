import { describe, expect, it } from 'vitest';
import { Axiomify } from '../src/app';

describe('Unified HookEngine Lifecycle', () => {
  it('should execute hooks in the correct order: Request -> PreHandler -> Handler -> PostHandler', async () => {
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
      handler: async (req, res) => {
        executionOrder.push('handler');
        res.status(200).send('ok');
      },
    });

    // Mock Request and Response for the test
    const mockReq = { method: 'GET', path: '/lifecycle', params: {}, id: 'test-req' } as any;
    const mockRes = {
      status: () => mockRes,
      send: () => {},
      header: () => mockRes,
      headersSent: false,
    } as any;

    // Trigger the framework lifecycle
    await app.handle(mockReq, mockRes);

    expect(executionOrder).toEqual([
      'onRequest',
      'onPreHandler',
      'handler',
      'onPostHandler',
    ]);
  });

  it('should catch handler errors and dispatch to onError', async () => {
    const app = new Axiomify();
    let errorCaught = false;

    app.addHook('onError', async (err: any) => {
      errorCaught = true;
      expect(err.message).toBe('Business Logic Failed');
    });

    app.route({
      method: 'GET',
      path: '/error',
      handler: async () => {
        throw new Error('Business Logic Failed');
      },
    });

    const mockReq = { method: 'GET', path: '/error', params: {}, id: 'test-req' } as any;
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
