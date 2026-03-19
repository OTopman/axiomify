import { z } from "zod";

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
  Params extends z.ZodTypeAny,
  Query extends z.ZodTypeAny,
  Body extends z.ZodTypeAny,
  Response extends z.ZodTypeAny,
  Plugins extends Plugin<any>[] = [],
> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  request?: {
    params?: Params;
    query?: Query;
    body?: Body;
    headers?: z.ZodTypeAny;
  };
  response: Response;

  // 🔌 Developers pass their plugins here
  plugins?: [...Plugins];

  // 🎯 The handler automatically receives the merged plugin context!
  handler: (
    ctx: RouteContext<
      z.infer<Params>,
      z.infer<Query>,
      z.infer<Body>,
      InferInjectedContext<Plugins>
    >,
  ) => Promise<z.infer<Response>> | z.infer<Response>;
}
