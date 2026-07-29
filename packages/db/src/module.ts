import type { AppContext, AppModule } from '@axiomify/core';
import {
  ClientKind,
  DerivedBehavior,
  deriveBehavior,
  detectClientKind,
} from './detect';

/** Default per-check timeout for {@link DatabaseHandle.healthCheck}. */
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;

export interface DatabaseModuleOptions<C = any> {
  /**
   * DI token the client is provided under, and the key used by
   * `dbHealthChecks()`. Must be unique per app. Default: `'db'`.
   */
  name?: string;
  /**
   * Factory that creates the client. May be async. Runs inside the vault
   * ALS scope named by {@link vaultScope} so `process.env` reads inside the
   * factory are attributed/authorized correctly.
   */
  client: () => C | Promise<C>;
  /** Establish the connection. Default: derived from the detected kind. */
  connect?: (client: C) => unknown;
  /** Tear the connection down. Default: derived from the detected kind. */
  disconnect?: (client: C) => unknown;
  /**
   * Liveness probe. Resolving (with anything other than `false`) means
   * healthy; throwing, resolving `false` or exceeding
   * {@link HEALTH_CHECK_TIMEOUT_MS} means unhealthy.
   * Default: derived from the detected kind.
   */
  healthCheck?: (client: C) => unknown;
  /**
   * Vault module scope to run the client factory inside
   * (`context.vault.scope(vaultScope, factory)`), so secrets policy for
   * that scope applies to `process.env` reads during client construction.
   */
  vaultScope?: string;
  /**
   * Self-wiring hook for graceful shutdown. Called once (at creation time)
   * with a callback that disconnects this database — e.g.
   * `registerShutdown: (cb) => shutdownCallbacks.push(cb)`.
   * Alternatively, collect handles yourself with `dbShutdown(...)`.
   */
  registerShutdown?: (cb: () => Promise<void>) => void;
}

/** What `createDatabaseModule()` returns. */
export interface DatabaseHandle<C = any> {
  /** The DI token / health-check key (the `name` option). */
  readonly name: string;
  /** Pass to `app.use()`. Module name is `@axiomify/db:<name>#<seq>` (instance-unique). */
  readonly module: AppModule;
  /**
   * Resolves with the real client once the factory + connect step finish.
   * Await this before `adapter.listen()`. Rejects if either step fails.
   */
  readonly ready: Promise<C>;
  /** The real client. Throws until {@link ready} has resolved. */
  readonly client: C;
  /** Detected client family ('unknown' until {@link ready} resolves). */
  readonly kind: ClientKind;
  /** True once the client is connected and usable. */
  readonly isReady: boolean;
  /** Disconnect the client (idempotent — safe to call multiple times). */
  disconnect(): Promise<void>;
  /**
   * Run the configured health probe with a 3s timeout.
   * Never throws — resolves `false` on error, timeout or when not ready.
   */
  healthCheck(): Promise<boolean>;
}

type Status = 'idle' | 'connecting' | 'ready' | 'failed' | 'disconnected';

/** Race a promise against a timeout, always clearing the timer. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`[@axiomify/db] ${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a client-agnostic database module for Axiomify.
 *
 * ### The sync-provide / async-ready pattern
 *
 * `app.use(module)` invokes `module.register()` **synchronously** and does
 * not await its return value (see `Axiomify.use` in `@axiomify/core` —
 * `vaultScope(mod.name, () => mod.register(this, moduleContext))` discards
 * the result). The DI container is also sealed at bootstrap, so any value a
 * module wants to provide must be provided during that synchronous call —
 * an async client factory cannot have finished by then.
 *
 * The module therefore provides a **stable Proxy handle** into DI
 * synchronously under the `name` token. The Proxy forwards property access
 * to the real client once `ready` has resolved; before that, any access
 * throws a clear "database not ready" error. The async work (factory +
 * connect) is kicked off in the background and surfaced through the
 * `ready` promise:
 *
 * ```ts
 * const db = createDatabaseModule({ client: async () => new PrismaClient() });
 * app.use(db.module);          // DI token 'db' is available immediately
 * await db.ready;              // <-- resolve BEFORE adapter.listen()
 * adapter.listen(3000);
 * ```
 *
 * Route handlers resolving `'db'` from DI get the same Proxy — by the time
 * requests arrive (after `await db.ready`), it behaves exactly like the
 * real client.
 */
let _dbModuleSeq = 0;

export function createDatabaseModule<C = any>(
  options: DatabaseModuleOptions<C>,
): DatabaseHandle<C> {
  if (typeof options?.client !== 'function') {
    throw new TypeError(
      '[@axiomify/db] createDatabaseModule requires a `client` factory function.',
    );
  }

  const name = options.name ?? 'db';
  let status: Status = 'idle';
  let realClient: C | undefined;
  let kind: ClientKind = 'unknown';
  let behavior: DerivedBehavior<C> | undefined;
  let disconnectPromise: Promise<void> | undefined;

  let resolveReady!: (client: C) => void;
  let rejectReady!: (err: unknown) => void;
  const ready = new Promise<C>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Mark the rejection as handled so a failed boot without a caller-side
  // `await db.ready` does not crash the process with an unhandledRejection.
  // Callers awaiting `ready` still observe the rejection normally.
  ready.catch(() => undefined);

  function notReadyError(prop?: string | symbol): Error {
    const detail =
      status === 'failed'
        ? 'The client factory or connect() step failed; await db.ready to inspect the error.'
        : status === 'disconnected'
          ? 'The client has been disconnected.'
          : 'Await db.ready before adapter.listen() (and before using the client).';
    const accessed =
      prop !== undefined ? ` (accessed property "${String(prop)}")` : '';
    return new Error(
      `[@axiomify/db] Database "${name}" is not ready${accessed}. ${detail}`,
    );
  }

  const proxy = new Proxy({} as object, {
    get(_target, prop) {
      if (status !== 'ready') {
        // Stay interop-safe before ready: `await proxy`, console.log and
        // similar machinery probe `then` / well-known symbols. Returning
        // undefined for those avoids confusing crashes in unrelated code;
        // every real property access still throws loudly.
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        throw notReadyError(prop);
      }
      const value = (realClient as Record<string | symbol, unknown>)[prop];
      // Bind methods to the real client so drivers using #private fields
      // (e.g. PrismaClient) don't receive the Proxy as `this`.
      return typeof value === 'function' ? value.bind(realClient) : value;
    },
    set(_target, prop, value) {
      if (status !== 'ready') throw notReadyError(prop);
      (realClient as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
    has(_target, prop) {
      if (status !== 'ready') return false;
      return prop in (realClient as object);
    },
    ownKeys() {
      return status === 'ready' ? Reflect.ownKeys(realClient as object) : [];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (status !== 'ready') return undefined;
      const desc = Reflect.getOwnPropertyDescriptor(realClient as object, prop);
      // The Proxy target is a plain {}; descriptors must be configurable to
      // satisfy Proxy invariants for properties the target doesn't own.
      if (desc) desc.configurable = true;
      return desc;
    },
  }) as C;

  async function initialize(context: AppContext): Promise<void> {
    try {
      const factory = options.client;
      const created = options.vaultScope
        ? await context.vault.scope(options.vaultScope, () => factory())
        : await factory();
      realClient = created;
      kind = detectClientKind(created);
      const derived = deriveBehavior(kind);
      behavior = {
        connect: options.connect ?? derived.connect,
        disconnect: options.disconnect ?? derived.disconnect,
        healthCheck: options.healthCheck ?? derived.healthCheck,
      };
      await behavior.connect(created);
      status = 'ready';
      resolveReady(created);
    } catch (err) {
      status = 'failed';
      rejectReady(err);
    }
  }

  const module: AppModule = {
    // Instance-unique module name: core dedups app.use() by module name, so
    // two DISTINCT handles sharing a DI token must not share a module name —
    // otherwise the second registration is silently skipped instead of
    // failing loudly in DI. Re-registering the SAME handle still dedups
    // (its name is stable).
    name: `@axiomify/db:${name}#${++_dbModuleSeq}`,
    register: (_app, context) => {
      // Synchronous provide — see the pattern note above. The DI container
      // seals at bootstrap, so this must not be deferred.
      context.provide(name, proxy);
      if (status === 'idle') {
        status = 'connecting';
        void initialize(context);
      }
    },
  };

  async function disconnect(): Promise<void> {
    if (!disconnectPromise) {
      disconnectPromise = (async () => {
        if (status === 'connecting') {
          // Let the in-flight boot settle so we never leak a half-open client.
          try {
            await ready;
          } catch {
            return; // boot failed — nothing to disconnect
          }
        }
        if (status !== 'ready') {
          status = 'disconnected';
          return;
        }
        await behavior!.disconnect(realClient as C);
        status = 'disconnected';
      })();
    }
    return disconnectPromise;
  }

  async function healthCheck(): Promise<boolean> {
    if (status !== 'ready') return false;
    try {
      const result = await withTimeout(
        Promise.resolve(behavior!.healthCheck(realClient as C)),
        HEALTH_CHECK_TIMEOUT_MS,
        `health check for database "${name}"`,
      );
      return result !== false;
    } catch {
      return false;
    }
  }

  const handle: DatabaseHandle<C> = {
    name,
    module,
    ready,
    get client(): C {
      if (status !== 'ready') throw notReadyError();
      return realClient as C;
    },
    get kind(): ClientKind {
      return kind;
    },
    get isReady(): boolean {
      return status === 'ready';
    },
    disconnect,
    healthCheck,
  };

  options.registerShutdown?.(() => disconnect());

  return handle;
}
