export interface AxiomifyRequest<RawEngine = unknown> {
  method: string;
  url: string;
  path: string;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  rawBody: unknown;
  engine: 'express' | 'fastify';
  originalRequest: RawEngine;
}

export interface Schema<T = unknown> {
  parseAsync: (data: unknown) => Promise<T>;
  _output?: T;
}

export type Infer<T> = T extends Schema<infer U> ? U : never;

export interface AxiomifyPlugin<InjectedData = void> {
  name: string;
  onRequest?: (req: AxiomifyRequest) => Promise<InjectedData> | InjectedData;
  onResponse?: (
    payload: unknown,
    req: AxiomifyRequest,
  ) => Promise<unknown> | unknown;
  onError?: (error: Error, req: AxiomifyRequest) => Promise<void> | void;
}

export type InferInjectedContext<T extends readonly AxiomifyPlugin<unknown>[]> =
  T extends readonly []
    ? {}
    : T extends readonly [
          AxiomifyPlugin<infer First>,
          ...infer Rest extends readonly AxiomifyPlugin<unknown>[],
        ]
      ? (First extends void ? {} : First) & InferInjectedContext<Rest>
      : {};

export type RouteContext<P, Q, B, Injected> = {
  params: P;
  query: Q;
  body: B;
  headers: Record<string, string | string[] | undefined>;
} & Injected;

// ✨ NEW: Template Literal inference for URL paths (e.g. '/users/:userId' -> { userId: string })
export type ExtractRouteParams<T extends string> = string extends T
  ? Record<string, string>
  : T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param]: string } & ExtractRouteParams<`/${Rest}`>
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : void;

// ✨ NEW: Multi-status response dictionary
export type ResponsesMap = Record<number, Schema | void>;

export interface RouteDefinition<
  Path extends string = string,
  P extends ExtractRouteParams<Path> | void = void,
  Q extends Schema | void = void,
  B extends Schema | void = void,
  R extends ResponsesMap = { 200: void },
  Plugins extends readonly AxiomifyPlugin<unknown>[] = [],
> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: Path;
  request?: {
    params?: Schema<P>;
    query?: Q;
    body?: B;
    headers?: Schema;
    multipart?: boolean; // 👈 Auto-activates file parsing for this route
  };
  responses: R;
  plugins?: Plugins;
  handler: (
    ctx: RouteContext<
      P,
      Q extends Schema ? Infer<Q> : void,
      B extends Schema ? Infer<B> : void,
      InferInjectedContext<Plugins>
    >,
  ) => Promise<
    {
      [K in keyof R]: {
        status: K;
        data: R[K] extends Schema ? Infer<R[K]> : void;
      };
    }[keyof R]
  >;
}

export interface AxiomifyConfig {
  server?: 'express' | 'fastify';
  port?: number;
  routesDir?: string;
  outputDir?: string;
  // ✨ NEW: Zero-Code Globals
  cors?: boolean | Record<string, any>;
  helmet?: boolean | Record<string, any>;
  bodyLimit?: string | number; // e.g. '10mb'
  globalPlugins?: AxiomifyPlugin<any>[];
  engineSetup?: (app: any) => void | Promise<void>;
  openapi?: { title?: string; description?: string; version?: string };
}