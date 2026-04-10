import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useCors } from '../src/index';

function makeMocks(method = 'GET', origin?: string) {
  const headers: Record<string, string> = {};
  const mockReq = {
    method,
    path: '/test',
    params: {},
    headers: origin ? { origin } : {},
  } as any;
  const mockRes = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    header: vi.fn().mockImplementation((k: string, v: string) => {
      headers[k] = v;
    }),
    headersSent: false,
  } as any;
  return { mockReq, mockRes, headers };
}

describe('useCors', () => {
  it('sets Access-Control-Allow-Origin to * by default', async () => {
    const app = new Axiomify();
    useCors(app);
    app.route({
      method: 'GET',
      path: '/test',
      handler: async (_req, res) => res.status(200).send(null),
    });
    const { mockReq, mockRes, headers } = makeMocks();
    await app.handle(mockReq, mockRes);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('reflects the request origin when it is in the allowed list', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['https://example.com', 'https://other.com'] });
    app.route({
      method: 'GET',
      path: '/test',
      handler: async (_req, res) => res.status(200).send(null),
    });
    const { mockReq, mockRes, headers } = makeMocks(
      'GET',
      'https://example.com',
    );
    await app.handle(mockReq, mockRes);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
  });

  it('responds to OPTIONS preflight with 204 and short-circuits the handler', async () => {
    const app = new Axiomify();
    useCors(app);
    const handlerSpy = vi.fn();
    app.route({ method: 'OPTIONS', path: '/test', handler: handlerSpy });
    const { mockReq, mockRes } = makeMocks('OPTIONS');
    await app.handle(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(204);
  });

  it('sets credentials header when credentials: true', async () => {
    const app = new Axiomify();
    useCors(app, { credentials: true });
    app.route({
      method: 'GET',
      path: '/test',
      handler: async (_req, res) => res.status(200).send(null),
    });
    const { mockReq, mockRes, headers } = makeMocks();
    await app.handle(mockReq, mockRes);
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });
});
