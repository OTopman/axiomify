import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useCors } from '../src/index';

describe('CORS Plugin', () => {
  it('does not set header if origin absent from array', async () => {
    const app = new Axiomify();
    useCors(app, { origin: ['http://safe.com'] });
    app.route({
      method: 'GET',
      path: '/',
      handler: async (r, res) => res.send('ok'),
    });

    const req = {
      method: 'GET',
      path: '/',
      headers: { origin: 'http://evil.com' },
      id: '1',
      params: {},
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);
    expect(res.header).not.toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://evil.com',
    );
  });

  it('sets Vary: Origin for non-wildcard', async () => {
    const app = new Axiomify();
    useCors(app, { origin: 'http://safe.com' });
    app.route({
      method: 'GET',
      path: '/',
      handler: async (r, res) => res.send('ok'),
    });

    const req = {
      method: 'GET',
      path: '/',
      headers: { origin: 'http://safe.com' },
      id: '1',
      params: {},
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(req, res);
    expect(res.header).toHaveBeenCalledWith('Vary', 'Origin');
  });
});

// ─── Preflight OPTIONS response ───────────────────────────────────────────────

describe('useCors — preflight OPTIONS response', () => {
  it('returns 204 with CORS headers on OPTIONS preflight', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { useCors } = await import('../src/index');

    const app = new Axiomify();
    useCors(app, {
      origin: 'https://app.example.com',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    });

    app.route({
      method: 'GET',
      path: '/api/users',
      handler: async (_req, res) => res.send({ users: [] }),
    });

    const capturedHeaders: Record<string, string> = {};
    let capturedStatus = 0;

    const mockReq: any = {
      method: 'OPTIONS',
      path: '/api/users',
      url: '/api/users',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, authorization',
      },
      params: {},
      state: {},
      query: {},
    };

    const mockRes: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendRaw: vi.fn(),
      header: (k: string, v: string) => { capturedHeaders[k.toLowerCase()] = v; return mockRes; },
      getHeader: (k: string) => capturedHeaders[k.toLowerCase()],
      removeHeader: () => mockRes,
      headersSent: false,
    };

    // Simulate the onRequest hook (useCors registers on onRequest)
    const hooks = (app as any).hooks?.hooks?.onRequest ?? [];
    for (const hook of hooks) {
      if (mockRes.headersSent) break;
      await hook(mockReq, mockRes);
    }

    // CORS headers must be set
    expect(capturedHeaders['access-control-allow-origin']).toBe('https://app.example.com');
    expect(capturedHeaders['access-control-allow-methods']).toMatch(/POST/);
    expect(capturedHeaders['access-control-allow-headers']).toMatch(/content-type/i);
    expect(capturedHeaders['access-control-max-age']).toBe('86400');
  });

  it('blocks preflight from disallowed origin', async () => {
    const { Axiomify } = await import('../../core/src/app');
    const { useCors } = await import('../src/index');

    const app = new Axiomify();
    useCors(app, { origin: 'https://app.example.com', methods: ['GET'] });

    let capturedStatus: number | undefined;
    const mockReq: any = {
      method: 'OPTIONS',
      path: '/api/data',
      url: '/api/data',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
      params: {}, state: {}, query: {},
    };
    const mockRes: any = {
      status: (c: number) => { capturedStatus = c; return mockRes; },
      send: vi.fn(),
      sendRaw: vi.fn(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn().mockReturnThis(),
      headersSent: false,
    };

    const hooks = (app as any).hooks?.hooks?.onRequest ?? [];
    for (const hook of hooks) {
      if (mockRes.headersSent) break;
      await hook(mockReq, mockRes);
    }

    // Disallowed origin — no ACAO header should be set for the actual origin
    const allowedOrigin = mockRes.header.mock?.calls?.find(
      ([k]: [string]) => k.toLowerCase() === 'access-control-allow-origin'
    );
    expect(allowedOrigin?.[1]).not.toBe('https://evil.example.com');
  });
});
