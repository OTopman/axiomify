import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/app';
import type { AxiomifyRequest, AxiomifyResponse } from '../src/types';

describe('Route-level Plugin System', () => {
  it('executes multiple plugins in the declared array order', async () => {
    const app = new Axiomify();
    const order: number[] = [];

    app.route({
      method: 'GET',
      path: '/ordered',
      plugins: [
        async () => {
          order.push(1);
        },
        async () => {
          order.push(2);
        },
        async () => {
          order.push(3);
        },
      ],
      handler: async (_req, res) => {
        res.status(200).send(null);
      },
    });

    const mockReq = {
      method: 'GET',
      path: '/ordered',
      params: {},
      headers: {},
      id: 'test-req',
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);
    expect(order).toEqual([1, 2, 3]);
  });

  it('executes inline route plugins before the route handler', async () => {
    const app = new Axiomify();
    const mockReq = {
      method: 'GET',
      path: '/test',
      params: {},
      headers: {},
      id: 'test-req',
    } as AxiomifyRequest;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as unknown as AxiomifyResponse;
    const pluginSpy = vi.fn();

    app.route({
      method: 'GET',
      path: '/test',
      plugins: [
        async () => {
          pluginSpy();
        },
      ],
      handler: () => {
        expect(pluginSpy).toHaveBeenCalled();
      },
    });

    await app.handle(mockReq, mockRes);
  });

  it('supports route plugins defined inline', async () => {
    const app = new Axiomify();
    const pluginSpy = vi.fn();
    const mockReq = {
      method: 'GET',
      path: '/inline',
      params: {},
      headers: {},
      id: 'test-req',
    } as AxiomifyRequest;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as unknown as AxiomifyResponse;

    app.route({
      method: 'GET',
      path: '/inline',
      plugins: [
        async () => {
          pluginSpy();
        },
      ],
      handler: () => {
        expect(pluginSpy).toHaveBeenCalledTimes(1);
      },
    });

    await app.handle(mockReq, mockRes);
  });

  it('stops execution if a plugin sends a response', async () => {
    const app = new Axiomify();
    const mockReq = {
      method: 'GET',
      path: '/auth',
      params: {},
      headers: {},
      id: 'test-req',
    } as AxiomifyRequest;

    const sendSpy = vi.fn();
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: sendSpy,
      get headersSent() {
        return sendSpy.mock.calls.length > 0;
      },
    } as unknown as AxiomifyResponse;

    const handlerSpy = vi.fn();
    const secondPluginSpy = vi.fn();

    app.route({
      method: 'GET',
      path: '/auth',
      plugins: [
        async (_req, res) => {
          res.status(401).send(null, 'Unauthorized');
        },
        async () => {
          secondPluginSpy();
        },
      ],
      handler: handlerSpy,
    });

    await app.handle(mockReq, mockRes);
    expect(sendSpy).toHaveBeenCalled();
    expect(secondPluginSpy).not.toHaveBeenCalled();
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
