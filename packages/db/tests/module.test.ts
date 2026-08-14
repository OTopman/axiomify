import { describe, it, expect, vi, afterEach } from 'vitest';
import { Axiomify } from '@axiomify/core';
import type { AppContext } from '@axiomify/core';
import {
  createDatabaseModule,
  HEALTH_CHECK_TIMEOUT_MS,
  withTimeout,
} from '../src/module';
import { fakeDrizzle, fakePgPool, fakePrisma } from './fakes';

function stubContext(overrides: Partial<AppContext> = {}): AppContext {
  const services = new Map<string | symbol, unknown>();
  return {
    provide: (token: string | symbol, value: unknown) => {
      services.set(token, value);
    },
    resolve: ((token: string | symbol) =>
      services.get(token)) as AppContext['resolve'],
    vault: { scope: (_name, fn) => fn() },
    ...overrides,
  } as AppContext;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createDatabaseModule', () => {
  it('requires a client factory', () => {
    expect(() => createDatabaseModule({} as never)).toThrow(
      /requires a `client` factory/,
    );
  });

  it('provides a handle into DI synchronously and resolves ready with the client', async () => {
    const prisma = fakePrisma();
    const db = createDatabaseModule({ client: async () => prisma });
    expect(db.module.name).toMatch(/^@axiomify\/db:db#\d+$/);

    const app = new Axiomify();
    app.use(db.module);

    // Token available immediately, before any awaiting.
    const injected = app.resolve<typeof prisma>('db');
    expect(injected).toBeDefined();

    await expect(db.ready).resolves.toBe(prisma);
    expect(prisma.$connect).toHaveBeenCalledOnce();
    expect(db.isReady).toBe(true);
    expect(db.kind).toBe('prisma');
    expect(db.client).toBe(prisma);

    // The injected proxy forwards to the real client once ready.
    await injected.$queryRaw();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('proxy access before ready throws the "not ready" error', () => {
    const db = createDatabaseModule({
      name: 'main',
      client: async () => new Promise(() => undefined), // never resolves
    });
    const app = new Axiomify();
    app.use(db.module);

    const proxy = app.resolve<Record<string, unknown>>('main');
    expect(() => proxy.query).toThrow(
      /Database "main" is not ready.*Await db\.ready before adapter\.listen\(\)/s,
    );
    expect(() => {
      proxy.query = 1;
    }).toThrow(/not ready/);
    expect('query' in proxy).toBe(false);
    expect(Object.keys(proxy)).toEqual([]);
    // Interop probes must not throw pre-ready.
    expect((proxy as { then?: unknown }).then).toBeUndefined();
    expect(proxy[Symbol.toStringTag as unknown as string]).toBeUndefined();
  });

  it('client getter throws before ready and after failure', async () => {
    const db = createDatabaseModule({
      client: () => {
        throw new Error('bad credentials');
      },
    });
    expect(() => db.client).toThrow(/not ready/);

    db.module.register(new Axiomify(), stubContext());
    await expect(db.ready).rejects.toThrow('bad credentials');
    expect(db.isReady).toBe(false);
    expect(() => db.client).toThrow(/factory or connect\(\) step failed/);
  });

  it('rejects ready when connect() fails', async () => {
    const db = createDatabaseModule({
      client: () => fakePrisma(),
      connect: () => Promise.reject(new Error('connect refused')),
    });
    db.module.register(new Axiomify(), stubContext());
    await expect(db.ready).rejects.toThrow('connect refused');
  });

  it('explicit connect/disconnect/healthCheck win over derived behavior', async () => {
    const prisma = fakePrisma();
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const healthCheck = vi.fn(async () => true);
    const db = createDatabaseModule({
      client: () => prisma,
      connect,
      disconnect,
      healthCheck,
    });
    db.module.register(new Axiomify(), stubContext());
    await db.ready;

    expect(connect).toHaveBeenCalledWith(prisma);
    expect(prisma.$connect).not.toHaveBeenCalled();

    await expect(db.healthCheck()).resolves.toBe(true);
    expect(healthCheck).toHaveBeenCalledWith(prisma);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();

    await db.disconnect();
    expect(disconnect).toHaveBeenCalledWith(prisma);
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it('runs the client factory inside the configured vault scope', async () => {
    const scope = vi.fn(<T>(_name: string, fn: () => T): T => fn());
    const db = createDatabaseModule({
      client: async () => fakeDrizzle(),
      vaultScope: 'database',
    });
    db.module.register(new Axiomify(), stubContext({ vault: { scope } }));
    await db.ready;
    expect(scope).toHaveBeenCalledWith('database', expect.any(Function));
    expect(db.kind).toBe('drizzle');
  });

  it('supports multiple named databases in one app', async () => {
    const prisma = fakePrisma();
    const { pool } = fakePgPool();
    const db1 = createDatabaseModule({ name: 'primary', client: () => prisma });
    const db2 = createDatabaseModule({ name: 'analytics', client: () => pool });

    const app = new Axiomify();
    app.use(db1.module).use(db2.module);
    await Promise.all([db1.ready, db2.ready]);

    expect(db1.module.name).toMatch(/^@axiomify\/db:primary#\d+$/);
    expect(db2.module.name).toMatch(/^@axiomify\/db:analytics#\d+$/);
    expect(db1.kind).toBe('prisma');
    expect(db2.kind).toBe('pg');
    expect(app.resolve('primary')).toBeDefined();
    expect(app.resolve('analytics')).toBeDefined();
    expect(pool.query).toHaveBeenCalledWith('SELECT 1'); // eager pg connect
  });

  it('rejects duplicate DI tokens across modules', () => {
    const app = new Axiomify();
    app.use(
      createDatabaseModule({ name: 'dup', client: () => fakePrisma() }).module,
    );
    expect(() =>
      app.use(
        createDatabaseModule({ name: 'dup', client: () => fakePrisma() })
          .module,
      ),
    ).toThrow(/already registered/);
  });

  it('registering the same module twice initializes only once', async () => {
    const factory = vi.fn(() => fakePrisma());
    const db = createDatabaseModule({ client: factory });
    const ctx1 = stubContext();
    db.module.register(new Axiomify(), ctx1);
    db.module.register(new Axiomify(), stubContext());
    await db.ready;
    expect(factory).toHaveBeenCalledOnce();
  });

  it('proxy binds methods to the real client and supports set/has/keys', async () => {
    class Client {
      #secret = 'internal';
      $connect() {}
      $disconnect() {}
      label = 'real';
      whoAmI() {
        return this.#secret; // throws if `this` is the Proxy
      }
    }
    const real = new Client();
    const db = createDatabaseModule<Client>({ client: () => real });
    const ctx = stubContext();
    db.module.register(new Axiomify(), ctx);
    await db.ready;

    const proxy = (ctx.resolve as (t: string) => Client)('db');
    expect(proxy.whoAmI()).toBe('internal');
    expect(proxy.label).toBe('real');
    (proxy as Client & { label: string }).label = 'updated';
    expect(real.label).toBe('updated');
    expect('label' in proxy).toBe(true);
    expect(Object.keys(proxy)).toContain('label');
  });

  it('disconnect is idempotent and flips the proxy to "disconnected"', async () => {
    const prisma = fakePrisma();
    const db = createDatabaseModule({ client: () => prisma });
    const ctx = stubContext();
    db.module.register(new Axiomify(), ctx);
    await db.ready;

    await Promise.all([db.disconnect(), db.disconnect()]);
    await db.disconnect();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(db.isReady).toBe(false);

    const proxy = (ctx.resolve as (t: string) => Record<string, unknown>)('db');
    expect(() => proxy.user).toThrow(/has been disconnected/);
  });

  it('disconnect during connect waits for boot to settle', async () => {
    const prisma = fakePrisma();
    let releaseFactory!: () => void;
    const db = createDatabaseModule({
      client: () =>
        new Promise<typeof prisma>((resolve) => {
          releaseFactory = () => resolve(prisma);
        }),
    });
    db.module.register(new Axiomify(), stubContext());

    const closing = db.disconnect();
    releaseFactory();
    await closing;
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('disconnect after a failed boot is a no-op', async () => {
    const db = createDatabaseModule({
      client: () => Promise.reject(new Error('nope')),
    });
    db.module.register(new Axiomify(), stubContext());
    await expect(db.ready).rejects.toThrow('nope');
    await expect(db.disconnect()).resolves.toBeUndefined();
  });

  it('disconnect before registration marks the handle disconnected', async () => {
    const factory = vi.fn(() => fakePrisma());
    const db = createDatabaseModule({ client: factory });
    await db.disconnect();
    db.module.register(new Axiomify(), stubContext());
    expect(factory).not.toHaveBeenCalled();
  });

  it('registerShutdown self-wires a disconnect callback', async () => {
    const prisma = fakePrisma();
    const callbacks: Array<() => Promise<void>> = [];
    const db = createDatabaseModule({
      client: () => prisma,
      registerShutdown: (cb) => callbacks.push(cb),
    });
    expect(callbacks).toHaveLength(1);

    db.module.register(new Axiomify(), stubContext());
    await db.ready;
    await callbacks[0]();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
});

describe('DatabaseHandle.healthCheck', () => {
  async function readyHandle(probe: (client: unknown) => unknown) {
    const db = createDatabaseModule({
      client: () => fakePrisma(),
      healthCheck: probe,
    });
    db.module.register(new Axiomify(), stubContext());
    await db.ready;
    return db;
  }

  it('resolves false when the database is not ready', async () => {
    const db = createDatabaseModule({ client: () => fakePrisma() });
    await expect(db.healthCheck()).resolves.toBe(false);
  });

  it('resolves true on a successful probe', async () => {
    const db = await readyHandle(async () => [{ ok: 1 }]);
    await expect(db.healthCheck()).resolves.toBe(true);
  });

  it('resolves false when the probe returns false or throws', async () => {
    await expect((await readyHandle(() => false)).healthCheck()).resolves.toBe(
      false,
    );
    await expect(
      (
        await readyHandle(() => Promise.reject(new Error('down')))
      ).healthCheck(),
    ).resolves.toBe(false);
  });

  it('resolves false when the probe exceeds the 3s timeout (fake timers)', async () => {
    const db = await readyHandle(() => new Promise(() => undefined));
    vi.useFakeTimers();
    const pending = db.healthCheck();
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
    await expect(pending).resolves.toBe(false);
  });
});

describe('withTimeout', () => {
  it('propagates the resolved value within the window', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with a labeled timeout error', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => undefined), 50, 'probe');
    const assertion = expect(pending).rejects.toThrow(
      /probe timed out after 50ms/,
    );
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
