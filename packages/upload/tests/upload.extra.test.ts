import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { useUpload } from '../src/index';

describe('useUpload', () => {
  it('registers onPreHandler and onError hooks', () => {
    const app = new Axiomify();
    useUpload(app);
    const hooks = (app as any).hooks.hooks;
    expect(hooks.onPreHandler.length).toBeGreaterThan(0);
    expect(hooks.onError.length).toBeGreaterThan(0);
  });

  it('onPreHandler resolves for non-multipart requests', async () => {
    const app = new Axiomify();
    useUpload(app);
    const req = {
      id: 'r1', method: 'POST', url: '/upload', path: '/upload',
      ip: '127.0.0.1', headers: { 'content-type': 'application/json' },
      body: {}, query: {}, params: {}, state: {}, raw: {}, stream: null,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(), removeHeader: vi.fn(), send: vi.fn(),
      sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
      headersSent: false, statusCode: 200, raw: {},
      capabilities: { sse: false, streaming: false },
    } as any;
    for (const h of (app as any).hooks.hooks.onPreHandler) {
      await expect(h(req, res, { route: { schema: {} } as any, params: {} }))
        .resolves.toBeUndefined();
    }
  });

  it('onError hook is registered and callable without throwing', async () => {
    const app = new Axiomify();
    useUpload(app);
    const req = {
      id: 'r1', method: 'POST', url: '/', path: '/', ip: '127.0.0.1',
      headers: {}, body: {}, query: {}, params: {}, state: {}, raw: {}, stream: null,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis(),
      getHeader: vi.fn(), removeHeader: vi.fn(), send: vi.fn(),
      sendRaw: vi.fn(), error: vi.fn(), stream: vi.fn(),
      headersSent: false, statusCode: 200, raw: {},
      capabilities: { sse: false, streaming: false },
    } as any;
    for (const h of (app as any).hooks.hooks.onError) {
      await expect(h(new Error('upload error'), req, res)).resolves.toBeUndefined();
    }
  });
});
