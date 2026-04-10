import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/app';
import type { AxiomifyRequest, AxiomifyResponse } from '../src/types';

describe('Route-level Plugin System', () => {
  it('executes multiple plugins in the declared array order', async () => {
    const app = new Axiomify();
    const order: number[] = [];

    app.registerPlugin('first', async () => {
      order.push(1);
    });
    app.registerPlugin('second', async () => {
      order.push(2);
    });
    app.registerPlugin('third', async () => {
      order.push(3);
    });

    app.route({
      method: 'GET',
      path: '/ordered',
      plugins: ['first', 'second', 'third'],
      handler: async (req, res) => {
        res.status(200).send(null);
      },
    });

    const mockReq = {
      method: 'GET',
      path: '/ordered',
      params: {},
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);
    expect(order).toEqual([1, 2, 3]);
  });

  it('executes registered plugins before the route handler', async () => {
    const app = new Axiomify();
    const mockReq = {
      method: 'GET',
      path: '/test',
      params: {},
      headers: {},
    } as AxiomifyRequest;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as unknown as AxiomifyResponse;
    const pluginSpy = vi.fn();

    app.registerPlugin('testPlugin', async (req, res) => {
      pluginSpy();
    });

    app.route({
      method: 'GET',
      path: '/test',
      plugins: ['testPlugin'],
      handler: () => {
        expect(pluginSpy).toHaveBeenCalled();
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

    app.registerPlugin('rejecter', async (req, res) => {
      res.status(401).send(null, 'Unauthorized');
    });
    app.registerPlugin('secondPlugin', async () => {
      secondPluginSpy();
    });

    app.route({
      method: 'GET',
      path: '/auth',
      plugins: ['rejecter', 'secondPlugin'],
      handler: handlerSpy,
    });

    await app.handle(mockReq, mockRes);
    expect(sendSpy).toHaveBeenCalled();
    expect(secondPluginSpy).not.toHaveBeenCalled();
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('throws an error if an unregistered plugin is referenced', async () => {
    const app = new Axiomify();
    const mockReq = {
      method: 'GET',
      path: '/fail',
      params: {},
      headers: {},
    } as AxiomifyRequest;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as unknown as AxiomifyResponse;

    app.route({
      method: 'GET',
      path: '/fail',
      plugins: ['missingPlugin'],
      handler: () => {},
    });

    await app.handle(mockReq, mockRes);
    // Framework handleError catches and sends 500
    expect(mockRes.status).toHaveBeenCalledWith(500);
  });

  it('throws an error if registering a plugin name twice', () => {
    const app = new Axiomify();
    app.registerPlugin('dup', () => {});
    expect(() => app.registerPlugin('dup', () => {})).toThrow(
      'is already registered',
    );
  });
});
