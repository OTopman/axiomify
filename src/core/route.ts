import {
  AxiomifyPlugin,
  ExtractRouteParams,
  Infer,
  ResponsesMap,
  RouteDefinition,
  Schema,
} from './types';

// An unconstrained AST Wrapper for the CLI scanner to read
export interface ClientRouteAST<P, Q, B, R> {
  _params: P;
  _query: Q;
  _body: B;
  _response: R;
}

export function route<
  Path extends string = string,
  P extends ExtractRouteParams<Path> | void = void,
  Q extends Schema | void = void,
  B extends Schema | void = void,
  R extends ResponsesMap = { 200: void },
  Plugins extends readonly AxiomifyPlugin<unknown>[] = [],
>(
  config: RouteDefinition<Path, P, Q, B, R, Plugins>,
): ClientRouteAST<
  P,
  Q extends Schema ? Infer<Q> : void,
  B extends Schema ? Infer<B> : void,
  // Flattens the multi-status ResponsesMap into a union of possible payload types for the frontend
  { [K in keyof R]: R[K] extends Schema ? Infer<R[K]> : void }[keyof R]
> {
  // Return the runtime config unchanged, but force the compiler to read the clean AST
  return config as any;
}
