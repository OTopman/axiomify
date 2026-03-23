import { z } from 'zod';

// A plugin takes the raw request and returns a typed object (or void if it just does a check).
export type Plugin<InjectedData extends Record<string, any> | void = void> = (
  req: any,
) => Promise<InjectedData> | InjectedData;

// This utility takes an array of Plugins and intersects their return types.
// Example: [Plugin<{ user: string }>, Plugin<{ db: any }>] becomes { user: string } & { db: any }
export type InferInjectedContext<T extends Plugin<any>[]> = T extends []
  ? {}
  : T extends [Plugin<infer First>, ...infer Rest extends Plugin<any>[]]
    ? (First extends void ? {} : First) & InferInjectedContext<Rest>
    : {};

// We keep the Zod inferences, but now we also intersect the injected plugin data.
export type RouteContext<P, Q, B, Injected = {}> = {
  params: P;
  query: Q;
  body: B;
  headers: Record<string, string | string[] | undefined>;
} & Injected;

export interface RouteDefinition<
  P extends z.ZodTypeAny = z.ZodAny,
  Q extends z.ZodTypeAny = z.ZodAny,
  B extends z.ZodTypeAny = z.ZodAny,
  R extends z.ZodTypeAny = z.ZodAny,
  Plugins extends Plugin<any>[] = Plugin<any>[],
> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  request?: {
    params?: P;
    query?: Q;
    body?: B;
    headers?: z.ZodTypeAny;
  };
  response: R;
  plugins?: [...Plugins];
  handler: (
    ctx: RouteContext<
      z.infer<P>,
      z.infer<Q>,
      z.infer<B>,
      InferInjectedContext<Plugins>
    >,
  ) => Promise<z.infer<R>> | z.infer<R>;
}

export interface AxiomifyConfig {
  /** The underlying HTTP server adapter to use. */
  server?: 'express' | 'fastify';
  /** The port the server will listen on. */
  port?: number;
  /** The directory where Axiomify should scan for route files. */
  routesDir?: string;
}