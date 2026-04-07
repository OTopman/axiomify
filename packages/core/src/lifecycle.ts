import type { AxiomifyRequest, AxiomifyResponse, RouteHandler } from './types';
export type HookType =
  | 'onRequest'
  | 'onPreHandler'
  | 'onPostHandler'
  | 'onError';

export class HookManager {
  private hooks: Record<HookType, Function[]> = {
    onRequest: [],
    onPreHandler: [],
    onPostHandler: [],
    onError: [],
  };

  add(type: HookType, fn: Function) {
    if (!this.hooks[type]) {
      this.hooks[type] = [];
    }
    this.hooks[type].push(fn);
  }

  public run(type: HookType, ...args: any[]): Promise<void> | void {
    const list = this.hooks[type];
    if (list.length === 0) return;
    return this.execute(list, args);
  }

  private async execute(list: Function[], args: any[]): Promise<void> {
    for (let i = 0; i < list.length; i++) {
      await list[i](...args);
    }
  }
}

export class ExecutionEngine {
  /**
   * The Core Request Runner.
   * Executes the developer's business logic.
   * Hook orchestration is now handled entirely by Axiomify.handle via HookEngine.
   */
  public async run(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    handler: RouteHandler | Function,
  ): Promise<void> {
    await handler(req as any, res);
  }
}
