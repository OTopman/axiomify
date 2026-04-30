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
