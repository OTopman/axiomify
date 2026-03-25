export interface AxiomifyRequest<RawEngine = unknown> {
  method: string;
  url: string;
  path: string;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  rawBody: unknown; 
  engine: 'express' | 'fastify';
  originalRequest: RawEngine; // Strongly typed escape hatch
}

// 1. Strict Schema Interface
export interface Schema<T = unknown> {
  parseAsync: (data: unknown) => Promise<T>;
  _output?: T;
}

// 2. Strict Type Inference Helper
export type Infer<T> = T extends Schema<infer U> ? U : never;

// 3. The Plugin Abstraction (Zero Any)
export interface AxiomifyPlugin<InjectedData = void> {
  name: string;
  onRequest?: (req: AxiomifyRequest) => Promise<InjectedData> | InjectedData;
  onResponse?: (
    payload: unknown,
    req: AxiomifyRequest,
  ) => Promise<unknown> | unknown;
  onError?: (error: Error, req: AxiomifyRequest) => Promise<void> | void;
}

// 4. Recursive Tuple Inference for Plugins
export type InferInjectedContext<T extends readonly AxiomifyPlugin<unknown>[]> =
  T extends readonly []
    ? {}
    : T extends readonly [
          AxiomifyPlugin<infer First>,
          ...infer Rest extends readonly AxiomifyPlugin<unknown>[],
        ]
      ? (First extends void ? {} : First) & InferInjectedContext<Rest>
      : {};

// 5. Route Context
export type RouteContext<P, Q, B, Injected> = {
  params: P;
  query: Q;
  body: B;
  headers: Record<string, string | string[] | undefined>;
} & Injected;

// 6. The Route Definition
export interface RouteDefinition<
  P extends Schema | void = void,
  Q extends Schema | void = void,
  B extends Schema | void = void,
  R extends Schema | void = void,
  Plugins extends readonly AxiomifyPlugin<unknown>[] = [], // Default to empty tuple
> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  request?: {
    params?: P;
    query?: Q;
    body?: B;
    headers?: Schema;
  };
  response: R;
  plugins?: Plugins;
  handler: (
    ctx: RouteContext<
      P extends Schema ? Infer<P> : void,
      Q extends Schema ? Infer<Q> : void,
      B extends Schema ? Infer<B> : void,
      InferInjectedContext<Plugins>
    >,
  ) =>
    | Promise<R extends Schema ? Infer<R> : void>
    | (R extends Schema ? Infer<R> : void);
}

export interface AxiomifyConfig {
  server?: 'express' | 'fastify';
  port?: number;
  routesDir?: string;
  openapi?: {
    title?: string;
    description?: string;
    version?: string;
  };
}
