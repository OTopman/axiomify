import { AxiomifyLogger, defaultLogger } from './internal';
import type {
  AxiomifyRequest,
  AxiomifyResponse,
  HookType,
  RouteDefinition,
} from './types';

export type HookHandlerMap = {
  onRequest: (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) => void | Promise<void>;
  onPreHandler: (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    match: { route: RouteDefinition; params: Record<string, string> },
  ) => void | Promise<void>;
  onPostHandler: (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    match: { route: RouteDefinition; params: Record<string, string> },
  ) => void | Promise<void>;
  onError: (
    err: unknown,
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) => void | Promise<void>;
  onClose: (
    req: AxiomifyRequest,
    res: AxiomifyResponse,
  ) => void | Promise<void>;
};

export class HookManager {
  public readonly hooks: { [K in HookType]: HookHandlerMap[K][] } = {
    onRequest: [],
    onPreHandler: [],
    onPostHandler: [],
    onError: [],
    onClose: [],
  };

  constructor(private readonly logger: AxiomifyLogger = defaultLogger) {}

  add<T extends HookType>(type: T, fn: HookHandlerMap[T]): void {
    this.hooks[type].push(fn);
  }

  /**
   * Fast-path hook runner.
   * - Returns `undefined` (sync) when the list is empty — zero Promise allocation.
   * - Calls the single handler directly when list.length === 1 — no loop overhead.
   * - Falls back to the sequential async loop for multiple handlers.
   *
   * The dispatcher MUST check the return value before awaiting:
   * ```ts
   * const ret = hooks.run('onRequest', req, res);
   * if (ret) await ret;
   * ```
   * This avoids creating a microtask in the zero-hook case (the common case).
   */
  public run<T extends HookType>(
    type: T,
    ...args: Parameters<HookHandlerMap[T]>
  ): Promise<void> | void {
    const list = this.hooks[type];
    if (list.length === 0) return; // sync fast-path — no Promise created
    if (list.length === 1) return (list[0] as (...a: unknown[]) => Promise<void> | void)(...(args as unknown[]));
    // Snapshot before iteration. A hook that calls app.addHook(type, ...) on
    // its own type would otherwise grow the array mid-loop and the new hook
    // would run for the current request — surprising, undocumented, and
    // makes "register hooks at startup" the only safe pattern. The slice
    // keeps "added during request affects next request" — the convention
    // matched by Express, Fastify, Koa.
    return this._executeSequential(
      (list as ((...a: unknown[]) => unknown)[]).slice(),
      args as unknown[],
    );
  }

  private async _executeSequential(
    snapshot: ((...args: unknown[]) => unknown)[],
    args: unknown[],
  ): Promise<void> {
    for (let i = 0; i < snapshot.length; i++) {
      await snapshot[i](...args);
    }
  }

  /**
   * Like `run` but swallows errors — used for onError and onClose where a
   * throwing hook must not prevent the finally block from completing.
   *
   * Returns `undefined` synchronously when no hooks are registered (zero
   * Promise allocation in the common case). Callers should check the return
   * value before awaiting.
   */
  public runSafe<T extends HookType>(
    type: T,
    ...args: Parameters<HookHandlerMap[T]>
  ): Promise<void> | void {
    const list = this.hooks[type];
    if (list.length === 0) return; // sync fast-path
    // Snapshot, same rationale as `run` above.
    return this._executeSafeSequential(
      type,
      (list as ((...a: unknown[]) => unknown)[]).slice(),
      args as unknown[],
    );
  }

  private async _executeSafeSequential(
    type: HookType,
    snapshot: ((...args: unknown[]) => unknown)[],
    args: unknown[],
  ): Promise<void> {
    for (const fn of snapshot) {
      try {
        await fn(...args);
      } catch (e) {
        this.logger.error(`[Axiomify] Hook "${type}" threw`, { error: e });
      }
    }
  }
}
