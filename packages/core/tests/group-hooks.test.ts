import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '../src/index';

function makeReq(overrides: any = {}): any {
  return {
    id: 'r1',
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
    ...overrides,
  };
}

function makeRes(): any {
  const headers: Record<string, string> = {};
  let sent = false;
  const res: any = {
    status: vi.fn().mockReturnThis(),
    header: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    getHeader: vi.fn((k: string) => headers[k]),
    removeHeader: vi.fn().mockReturnThis(),
    send: vi.fn(() => {
      sent = true;
    }),
    sendRaw: vi.fn(),
    stream: vi.fn(),
    get headersSent() {
      return sent;
    },
    statusCode: 200,
    raw: {},
    capabilities: { sse: false, streaming: false },
  };
  return res;
}

describe('group-scoped hooks (encapsulation)', () => {
  it('onPreHandler fires only for routes inside the group', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.route({ method: 'GET', path: '/public', handler: (_r, res) => res.send('ok') });
    app.group('/admin', (g) => {
      g.addHook('onPreHandler', scoped);
      g.route({ method: 'GET', path: '/users', handler: (_r, res) => res.send('ok') });
    });

    await app.handle(makeReq({ path: '/public' }), makeRes());
    expect(scoped).not.toHaveBeenCalled();

    await app.handle(makeReq({ path: '/admin/users' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
    const match = scoped.mock.calls[0][2];
    expect(match.route.path).toBe('/admin/users');
  });

  it('onPostHandler is scoped to the group', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.route({ method: 'GET', path: '/out', handler: (_r, res) => res.send('ok') });
    app.group('/in', (g) => {
      g.addHook('onPostHandler', scoped);
      g.route({ method: 'GET', path: '/a', handler: (_r, res) => res.send('ok') });
    });

    await app.handle(makeReq({ path: '/out' }), makeRes());
    await app.handle(makeReq({ path: '/in/a' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
  });

  it('parent group hooks fire for routes registered in nested groups', async () => {
    const app = new Axiomify();
    const parentHook = vi.fn();
    const childHook = vi.fn();

    app.group('/api', (api) => {
      api.addHook('onPreHandler', parentHook);
      api.group('/v1', (v1) => {
        v1.addHook('onPreHandler', childHook);
        v1.route({ method: 'GET', path: '/users', handler: (_r, res) => res.send('ok') });
      });
      api.route({ method: 'GET', path: '/status', handler: (_r, res) => res.send('ok') });
    });

    await app.handle(makeReq({ path: '/api/v1/users' }), makeRes());
    expect(parentHook).toHaveBeenCalledTimes(1);
    expect(childHook).toHaveBeenCalledTimes(1);

    // Sibling route: parent's hook fires, child's does not.
    await app.handle(makeReq({ path: '/api/status' }), makeRes());
    expect(parentHook).toHaveBeenCalledTimes(2);
    expect(childHook).toHaveBeenCalledTimes(1);
  });

  it('onRequest is scoped by path prefix', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.route({ method: 'GET', path: '/other', handler: (_r, res) => res.send('ok') });
    app.group('/api', (g) => {
      g.addHook('onRequest', scoped);
      g.route({ method: 'GET', path: '/x', handler: (_r, res) => res.send('ok') });
    });

    await app.handle(makeReq({ path: '/other' }), makeRes());
    expect(scoped).not.toHaveBeenCalled();
    await app.handle(makeReq({ path: '/api/x' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
  });

  it('prefix matching respects segment boundaries', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.route({ method: 'GET', path: '/apiv2/x', handler: (_r, res) => res.send('ok') });
    app.group('/api', (g) => {
      g.addHook('onRequest', scoped);
      g.route({ method: 'GET', path: '/x', handler: (_r, res) => res.send('ok') });
    });

    // /apiv2 must NOT match the /api group prefix.
    await app.handle(makeReq({ path: '/apiv2/x' }), makeRes());
    expect(scoped).not.toHaveBeenCalled();
  });

  it('prefix-scoped hooks handle :param segments in the prefix', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.group('/tenants/:tenantId', (g) => {
      g.addHook('onRequest', scoped);
      g.route({ method: 'GET', path: '/info', handler: (_r, res) => res.send('ok') });
    });
    app.route({ method: 'GET', path: '/tenants', handler: (_r, res) => res.send('ok') });

    await app.handle(makeReq({ path: '/tenants/acme/info' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
    // Bare collection route is outside the parametrised group scope.
    await app.handle(makeReq({ path: '/tenants' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
  });

  it('onError fires only for errors raised under the group prefix', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.route({
      method: 'GET',
      path: '/boom',
      handler: () => {
        throw new Error('outside');
      },
    });
    app.group('/api', (g) => {
      g.addHook('onError', scoped);
      g.route({
        method: 'GET',
        path: '/boom',
        handler: () => {
          throw new Error('inside');
        },
      });
    });

    await app.handle(makeReq({ path: '/boom' }), makeRes());
    expect(scoped).not.toHaveBeenCalled();

    await app.handle(makeReq({ path: '/api/boom' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
    expect((scoped.mock.calls[0][0] as Error).message).toBe('inside');
  });

  it('onClose is scoped by path prefix', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();

    app.route({ method: 'GET', path: '/a', handler: (_r, res) => res.send('ok') });
    app.group('/api', (g) => {
      g.addHook('onClose', scoped);
      g.route({ method: 'GET', path: '/a', handler: (_r, res) => res.send('ok') });
    });

    await app.handle(makeReq({ path: '/a' }), makeRes());
    expect(scoped).not.toHaveBeenCalled();
    await app.handle(makeReq({ path: '/api/a' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
  });

  it('global hooks still fire for group routes', async () => {
    const app = new Axiomify();
    const globalHook = vi.fn();

    app.addHook('onPreHandler', globalHook);
    app.group('/api', (g) => {
      g.route({ method: 'GET', path: '/x', handler: (_r, res) => res.send('ok') });
    });

    await app.handle(makeReq({ path: '/api/x' }), makeRes());
    expect(globalHook).toHaveBeenCalledTimes(1);
  });

  it('addHook returns the group proxy for chaining', () => {
    const app = new Axiomify();
    app.group('/api', (g) => {
      const returned = g.addHook('onRequest', () => {});
      expect(returned).toBe(g);
    });
  });

  it('root-prefix groups scope prefix hooks to every request', async () => {
    const app = new Axiomify();
    const scoped = vi.fn();
    app.group('/', (g) => {
      g.addHook('onRequest', scoped);
      g.route({ method: 'GET', path: '/x', handler: (_r, res) => res.send('ok') });
    });
    await app.handle(makeReq({ path: '/x' }), makeRes());
    expect(scoped).toHaveBeenCalledTimes(1);
  });
});
