import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/app';

describe('Request timeout', () => {
  it('resolves normally when handler responds within the timeout', async () => {
    const app = new Axiomify({ timeout: 500 });
    app.route({
      method: 'GET',
      path: '/fast',
      handler: async (_req, res) => {
        res.status(200).send(null);
      },
    });
    const mockReq = {
      method: 'GET',
      path: '/fast',
      params: {},
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as any;
    await expect(app.handle(mockReq, mockRes)).resolves.not.toThrow();
  });

  it('sends a 503 when the handler exceeds the global timeout', async () => {
    vi.useFakeTimers();
    const app = new Axiomify({ timeout: 100 });
    app.route({
      method: 'GET',
      path: '/slow',
      handler: () => new Promise(() => {}), // never resolves
    });
    const mockReq = {
      method: 'GET',
      path: '/slow',
      params: {},
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as any;

    const handlePromise = app.handle(mockReq, mockRes);
    vi.advanceTimersByTime(200);
    await handlePromise;

    expect(mockRes.status).toHaveBeenCalledWith(503);
    vi.useRealTimers();
  });

  it('respects a per-route timeout that overrides the global', async () => {
    vi.useFakeTimers();
    const app = new Axiomify({ timeout: 5000 }); // slow global
    app.route({
      method: 'GET',
      path: '/strict',
      timeout: 50, // fast per-route override
      handler: () => new Promise(() => {}),
    });
    const mockReq = {
      method: 'GET',
      path: '/strict',
      params: {},
      headers: {},
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      headersSent: false,
    } as any;

    const handlePromise = app.handle(mockReq, mockRes);
    vi.advanceTimersByTime(100);
    await handlePromise;

    expect(mockRes.status).toHaveBeenCalledWith(503);
    vi.useRealTimers();
  });
});
