import { z } from 'zod';
export { z } from 'zod';

type Plugin<InjectedData extends Record<string, any> | void = void> = (req: any) => Promise<InjectedData> | InjectedData;
type InferInjectedContext<T extends Plugin<any>[]> = T extends [] ? {} : T extends [Plugin<infer First>, ...infer Rest extends Plugin<any>[]] ? (First extends void ? {} : First) & InferInjectedContext<Rest> : {};
type RouteContext<P, Q, B, Injected = {}> = {
    params: P;
    query: Q;
    body: B;
    headers: Record<string, string | string[] | undefined>;
} & Injected;
interface RouteDefinition<P extends z.ZodTypeAny = z.ZodAny, Q extends z.ZodTypeAny = z.ZodAny, B extends z.ZodTypeAny = z.ZodAny, R extends z.ZodTypeAny = z.ZodAny, Plugins extends Plugin<any>[] = Plugin<any>[]> {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    request?: {
        params?: P;
        query?: Q;
        body?: B;
        headers?: z.ZodTypeAny;
    };
    response: R;
    plugins?: [...Plugins];
    handler: (ctx: RouteContext<z.infer<P>, z.infer<Q>, z.infer<B>, InferInjectedContext<Plugins>>) => Promise<z.infer<R>> | z.infer<R>;
}

/**
 * The Axiomify Route Builder.
 * * @param config The route configuration including Zod schemas and the handler.
 * @returns The exact same configuration object, but with strictly inferred types.
 */
declare function route<P extends z.ZodTypeAny = z.ZodVoid, Q extends z.ZodTypeAny = z.ZodVoid, B extends z.ZodTypeAny = z.ZodVoid, R extends z.ZodTypeAny = z.ZodVoid>(config: RouteDefinition<P, Q, B, R>): RouteDefinition<P, Q, B, R>;

export { type InferInjectedContext, type Plugin, type RouteContext, type RouteDefinition, route };
