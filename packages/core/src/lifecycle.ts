import type {
  AxiomifyRequest,
  AxiomifyResponse,
  HookType,
  RouteDefinition,
  RouteHandler,
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
  private hooks: { [K in HookType]: HookHandlerMap[K][] } = {
    onRequest: [],
    onPreHandler: [],
    onPostHandler: [],
    onError: [],
    onClose: [],
  };

  add<T extends HookType>(type: T, fn: HookHandlerMap[T]): void {
    if (!this.hooks[type]) {
      this.hooks[type] = [];
    }
    this.hooks[type].push(fn);
  }

  public run<T extends HookType>(
    type: T,
    ...args: Parameters<HookHandlerMap[T]>
  ): Promise<void> | void {
    const list = this.hooks[type];
    if (list.length === 0) return;
    return this.execute(list, args);
  }

  private async execute(
    list: ((...args: any[]) => any)[],
    args: unknown[],
  ): Promise<void> {
    for (let i = 0; i < list.length; i++) {
      await list[i](...(args as any));
    }
  }
}

export class ExecutionEngine {
  public async run(
    req: AxiomifyRequest,
    res: AxiomifyResponse,
    handler: RouteHandler,
  ): Promise<void> {
    await handler(req as any, res);
  }
}
