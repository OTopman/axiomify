import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Axiomify } from '../src/app';
import { RequestStateImpl } from '../src/state';
import { ValidationError } from '../src/validation';
import { AxiomifyError } from '../src/errors';

describe('Router conflicts & Strict checks', () => {
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('throws on conflicting parameterized routes by default (routeConflict: throw)', () => {
    const app = new Axiomify({ routeConflict: 'throw' });
    app.route({
      method: 'GET',
      path: '/users/:userId',
      handler: () => {
        '@axiomify-ignore-schema';
      },
    });

    expect(() => {
      app.route({
        method: 'GET',
        path: '/users/:id',
        handler: () => {
          '@axiomify-ignore-schema';
        },
      });
    }).toThrow(/Conflicting parameterized routes/);
  });

  it('warns on conflicting parameterized routes when routeConflict is warn', () => {
    const app = new Axiomify({ routeConflict: 'warn' });
    app.route({
      method: 'GET',
      path: '/users/:userId',
      handler: () => {
        '@axiomify-ignore-schema';
      },
    });

    app.route({
      method: 'GET',
      path: '/users/:id',
      handler: () => {
        '@axiomify-ignore-schema';
      },
    });

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain(
      'Conflicting parameterized routes',
    );
  });

  it('does not throw/warn for non-conflicting routes', () => {
    const app = new Axiomify({ routeConflict: 'throw' });
    app.route({
      method: 'GET',
      path: '/users/:userId/profile',
      handler: () => {
        '@axiomify-ignore-schema';
      },
    });

    expect(() => {
      app.route({
        method: 'GET',
        path: '/users/:userId/posts',
        handler: () => {
          '@axiomify-ignore-schema';
        },
      });
    }).not.toThrow();
  });

  it('throws on schema-less route when strictSchema is true', () => {
    const app = new Axiomify({ strictSchema: true });
    expect(() => {
      app.route({
        method: 'GET',
        path: '/test',
        handler: () => {},
      });
    }).toThrow(/has a typed handler but no schema defined/);
  });

  it('does not throw on schema-less route when strictSchema is true but ignore comment is present', () => {
    const app = new Axiomify({ strictSchema: true });
    expect(() => {
      app.route({
        method: 'GET',
        path: '/test',
        handler: () => {
          '@axiomify-ignore-schema';
        },
      });
    }).not.toThrow();
  });

  it('schedules a warning on next tick on schema-less route when strictSchema is false', async () => {
    consoleWarnSpy.mockClear();
    const app = new Axiomify({ strictSchema: false });
    app.route({
      method: 'GET',
      path: '/test-warn',
      handler: () => {},
    });

    // Wait for the next tick warning
    await new Promise((resolve) => process.nextTick(resolve));

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain(
      'The following routes are schema-less: GET /test-warn',
    );
  });

  it('does not warn on next tick on schema-less route with ignore comment when strictSchema is false', async () => {
    consoleWarnSpy.mockClear();
    const app = new Axiomify({ strictSchema: false });
    app.route({
      method: 'GET',
      path: '/test-warn-ignored',
      handler: () => {
        '@axiomify-ignore-schema';
      },
    });

    await new Promise((resolve) => process.nextTick(resolve));
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe('DI Container Sealing', () => {
  it('prevents registering service after bootstrap listen()', () => {
    const app = new Axiomify();
    app.use((app, ctx) => {
      ctx.provide('foo', 'bar');
    });

    app.listen();

    app.use((app, ctx) => {
      expect(() => {
        ctx.provide('baz', 'qux');
      }).toThrow(/DI container is sealed/);
    });
  });

  it('prevents registering service after bootstrap build()', () => {
    const app = new Axiomify();
    app.use((app, ctx) => {
      ctx.provide('foo', 'bar');
    });

    app.build();

    app.use((app, ctx) => {
      expect(() => {
        ctx.provide('baz', 'qux');
      }).toThrow(/DI container is sealed/);
    });
  });

  it('prevents registering duplicate service tokens', () => {
    const app = new Axiomify();
    app.use((app, ctx) => {
      ctx.provide('dup', 'first');
      expect(() => {
        ctx.provide('dup', 'second');
      }).toThrow(/is already registered/);
    });
  });

  it('allows registering service after bootstrap using forceProvide', () => {
    const app = new Axiomify();
    app.listen();
    expect(() => {
      app.forceProvide('foo', 'bar');
    }).not.toThrow();

    let resolvedVal: any;
    app.use((app, ctx) => {
      resolvedVal = ctx.resolve('foo');
    });
    expect(resolvedVal).toBe('bar');
  });
});

describe('Request State Immutability', () => {
  it('throws when setting a duplicate key via .set()', () => {
    const state = new RequestStateImpl();
    state.set('key1', 'value1');
    expect(() => state.set('key1', 'value2')).toThrow(/is immutable once set/);
  });

  it('throws when setting a duplicate key via direct property access', () => {
    const state = new RequestStateImpl();
    state.key1 = 'value1';
    expect(() => {
      state.key1 = 'value2';
    }).toThrow(/is immutable once set/);
  });

  it('retrieves values correctly via .get() and direct property access', () => {
    const state = new RequestStateImpl();
    state.set('key1', 'value1');
    state.key2 = 'value2';

    expect(state.get('key1')).toBe('value1');
    expect(state.key1).toBe('value1');
    expect(state.get('key2')).toBe('value2');
    expect(state.key2).toBe('value2');
  });

  it('freezes the user object when set', () => {
    const state = new RequestStateImpl();
    const userObj = { name: 'Alice', roles: ['admin'] };
    state.set('user', userObj);

    expect(Object.isFrozen(userObj)).toBe(true);
    expect(() => {
      userObj.name = 'Bob';
    }).toThrow();
  });

  it('freezes the user object when set via direct property access', () => {
    const state = new RequestStateImpl();
    const userObj = { name: 'Alice', roles: ['admin'] };
    state.user = userObj;

    expect(Object.isFrozen(userObj)).toBe(true);
    expect(() => {
      userObj.name = 'Bob';
    }).toThrow();
  });

  it('supports symbol properties via Reflect fallback', () => {
    const state = new RequestStateImpl();
    const sym = Symbol('test');
    (state as any)[sym] = 'symbolValue';
    expect((state as any)[sym]).toBe('symbolValue');
  });
});

describe('404 & 405 Custom Handlers', () => {
  it('calls setNotFoundHandler when route is missing', async () => {
    const app = new Axiomify();
    let called = false;
    app.setNotFoundHandler(async (req, res) => {
      called = true;
      res.status(404).send({ error: 'custom-404' });
    });

    const req: any = {
      method: 'GET',
      path: '/non-existent',
      headers: {},
      id: 'req_1',
      params: {},
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header: vi.fn().mockReturnThis(),
      headersSent: false,
    };

    await app.handle(req, res);
    expect(called).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ error: 'custom-404' });
  });

  it('calls setMethodNotAllowedHandler when method is mismatched', async () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/only-post',
      handler: () => {
        '@axiomify-ignore-schema';
      },
    });

    let called = false;
    app.setMethodNotAllowedHandler(async (req, res) => {
      called = true;
      res.status(405).send({ error: 'custom-405' });
    });

    const req: any = {
      method: 'GET',
      path: '/only-post',
      headers: {},
      id: 'req_2',
      params: {},
      state: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      header(k: string, v: string) {
        this.headers = this.headers || {};
        this.headers[k] = v;
        return this;
      },
      getHeader(k: string) {
        return this.headers?.[k];
      },
      headersSent: false,
    };

    await app.handle(req, res);
    expect(called).toBe(true);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.send).toHaveBeenCalledWith({ error: 'custom-405' });
  });
});
