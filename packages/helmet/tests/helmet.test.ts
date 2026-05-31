import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useHelmet } from '../src/index';

describe('Helmet Plugin', () => {
  it('sets default security headers', async () => {
    const app = new Axiomify();
    useHelmet(app);

    app.route({
      method: 'GET',
      path: '/',
      handler: async (req, res) => res.status(200).send('ok'),
    });

    const mockReq = {
      method: 'GET',
      path: '/',
      params: {},
      headers: {},
      id: 'req-1',
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);

    expect(mockRes.header).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
    expect(mockRes.header).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(mockRes.header).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains',
    );
  });

  it('allows disabling specific headers', async () => {
    const app = new Axiomify();
    useHelmet(app, { xFrameOptions: false });

    app.route({
      method: 'GET',
      path: '/',
      handler: async (req, res) => res.status(200).send('ok'),
    });
    const mockReq = {
      method: 'GET',
      path: '/',
      params: {},
      headers: {},
      id: 'req-2',
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);
    expect(mockRes.header).not.toHaveBeenCalledWith(
      'X-Frame-Options',
      expect.any(String),
    );
  });

  it('sets HSTS when opted in', async () => {
    const app = new Axiomify();
    useHelmet(app, { hsts: true });

    app.route({
      method: 'GET',
      path: '/',
      handler: async (req, res) => res.status(200).send('ok'),
    });
    const mockReq = {
      method: 'GET',
      path: '/',
      params: {},
      headers: {},
      id: 'req-3',
    } as any;
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    } as any;

    await app.handle(mockReq, mockRes);
    expect(mockRes.header).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains',
    );
  });
});

describe('useHelmet — HSTS object config and removePoweredBy:false', () => {
  it('configures HSTS with object options including preload', async () => {
    const app = new Axiomify();
    useHelmet(app, {
      hsts: { maxAge: 31536000, includeSubDomains: false, preload: true },
    });
    const req = {
      id: 'r',
      method: 'GET',
      url: '/',
      path: '/',
      ip: '127.0.0.1',
      headers: {},
      body: undefined,
      query: {},
      params: {},
      state: {},
      raw: {},
      stream: null,
    } as any;
    const headers: Record<string, string> = {};
    const res: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn((k: string, v: string) => {
        headers[k] = v;
        return res;
      }),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      send: vi.fn(),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      headersSent: false,
      statusCode: 200,
      raw: {},
      capabilities: { sse: false, streaming: false },
    };
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    expect(headers['Strict-Transport-Security']).toContain('preload');
    expect(headers['Strict-Transport-Security']).not.toContain(
      'includeSubDomains',
    );
  });

  it('when removePoweredBy is false, does not add X-Powered-By to removeHeaders', async () => {
    const app = new Axiomify();
    // With removePoweredBy:false and explicit empty removeHeaders,
    // X-Powered-By should NOT be in the removed set.
    useHelmet(app, { removePoweredBy: false, removeHeaders: [] });
    const req = {
      id: 'r',
      method: 'GET',
      url: '/',
      path: '/',
      ip: '127.0.0.1',
      headers: {},
      body: undefined,
      query: {},
      params: {},
      state: {},
      raw: {},
      stream: null,
    } as any;
    const res: any = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      send: vi.fn(),
      sendRaw: vi.fn(),
      error: vi.fn(),
      stream: vi.fn(),
      headersSent: false,
      statusCode: 200,
      raw: {},
      capabilities: { sse: false, streaming: false },
    };
    for (const h of (app as any).hooks.hooks.onRequest) await h(req, res);
    const removedHeaders = (
      res.removeHeader as ReturnType<typeof vi.fn>
    ).mock.calls.map((c: any[]) => c[0]);
    expect(removedHeaders).not.toContain('X-Powered-By');
  });
});
