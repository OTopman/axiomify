// 1. The Agnostic Schema Interface
export interface Schema<T = any> {
  parseAsync: (data: unknown) => Promise<T>;
  // Virtual property for TypeScript to infer the resulting type
  _output?: T;
}

// 2. Type Inference Helper
export type Infer<T> = T extends Schema<infer U> ? U : never;

// 3. Update RouteContext to use the generic Inference
export type RouteContext<P, Q, B, Injected = {}> = {
  params: P;
  query: Q;
  body: B;
  headers: Record<string, string | string[] | undefined>;
} & Injected;

// 4. Update RouteDefinition to accept ANY Schema, not just Zod
export interface RouteDefinition<
  P extends Schema | void = void,
  Q extends Schema | void = void,
  B extends Schema | void = void,
  R extends Schema | void = void,
  // 👇 FIX: Default to the generic array, not an empty tuple []
  Plugins extends AxiomifyPlugin<any>[] = AxiomifyPlugin<any>[],
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
  plugins?: [...Plugins];
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

export interface AxiomifyPlugin<
  InjectedData extends Record<string, any> | void = void,
> {
  name: string;
  /** Executes before validation. Used to inject typed context (e.g., Auth, DB). */
  onRequest?: (req: any) => Promise<InjectedData> | InjectedData;
  /** Executes before sending the response. Used for mutation, caching, or telemetry. */
  onResponse?: (payload: any, req: any) => Promise<any> | any;
  /** Executes when an error is thrown. Used for custom logging or telemetry. */
  onError?: (error: Error, req: any) => Promise<void> | void;
}

// Update the Inference helper to look at the onRequest return type
export type InferInjectedContext<T extends AxiomifyPlugin<any>[]> = T extends []
  ? {}
  : T extends [
        AxiomifyPlugin<infer First>,
        ...infer Rest extends AxiomifyPlugin<any>[],
      ]
    ? (First extends void ? {} : First) & InferInjectedContext<Rest>
    : {};

export interface AxiomifyConfig {
  /** The underlying HTTP server adapter to use. */
  server?: 'express' | 'fastify';
  /** The port the server will listen on. */
  port?: number;
  /** The directory where Axiomify should scan for route files. */
  routesDir?: string;

  /** Custom metadata for the auto-generated OpenAPI documentation */
  openapi?: {
    title?: string;
    description?: string;
    version?: string;
  };
}
