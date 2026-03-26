import { AxiomifyPlugin, Infer, RouteDefinition, Schema } from './types';

// An unconstrained AST Wrapper for the CLI scanner to read
export interface ClientRouteAST<P, Q, B, R> {
  _params: P;
  _query: Q;
  _body: B;
  _response: R;
}

export function route<
  P extends Schema | void = void,
  Q extends Schema | void = void,
  B extends Schema | void = void,
  R extends Schema | void = void,
  Plugins extends readonly AxiomifyPlugin<unknown>[] = [],
>(
  config: RouteDefinition<P, Q, B, R, Plugins>,
): ClientRouteAST<
  P extends Schema ? Infer<P> : void,
  Q extends Schema ? Infer<Q> : void,
  B extends Schema ? Infer<B> : void,
  R extends Schema ? Infer<R> : void
> {
  // Return the runtime config unchanged, but force the compiler to read the clean AST
  return config as any;
}
