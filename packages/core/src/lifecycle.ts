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

  add<T extends HookType>(type: T, fn: HookHandlerMap[T]): void {
    this.hooks[type].push(fn);
  }

  /**
   * Fast-path hook runner.
   * - Returns `undefined` (sync) when the list is empty — zero Promise allocation.
   * - Calls the single handler directly when list.length === 1 — no loop overhead.
   * - Falls back to the sequential async loop for multiple handlers.
   */
  public run<T extends HookType>(
    type: T,
    ...args: Parameters<HookHandlerMap[T]>
  ): Promise<void> | void {
    const list = this.hooks[type];
    if (list.length === 0) return; // sync fast-path — no Promise created
    if (list.length === 1) return (list[0] as (...a: unknown[]) => Promise<void> | void)(...(args as unknown[]));
    return this._executeSequential(list as ((...a: unknown[]) => unknown)[], args as unknown[]);
  }

  private async _executeSequential(
    list: ((...args: unknown[]) => unknown)[],
    args: unknown[],
  ): Promise<void> {
    for (let i = 0; i < list.length; i++) {
      await list[i](...args);
    }
  }

  /**
   * Like `run` but swallows errors — used for onError and onClose where a
   * throwing hook must not prevent the finally block from completing.
   */
  public async runSafe<T extends HookType>(
    type: T,
    ...args: Parameters<HookHandlerMap[T]>
  ): Promise<void> {
    const list = this.hooks[type];
    if (list.length === 0) return; // sync fast-path
    for (const fn of list) {
      try {
        await (fn as (...a: unknown[]) => unknown)(...(args as unknown[]));
      } catch (e) {
        console.error(`[Axiomify] Hook "${type}" threw:`, e);
      }
    }
  }
}

