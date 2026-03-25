import { AxiomifyPlugin, RouteDefinition, Schema } from './types';

// The route function acts purely as a generic identity function for perfect IDE inference
export function route<
  P extends Schema | void = void,
  Q extends Schema | void = void,
  B extends Schema | void = void,
  R extends Schema | void = void,
  Plugins extends readonly AxiomifyPlugin<unknown>[] = [],
>(
  config: RouteDefinition<P, Q, B, R, Plugins>,
): RouteDefinition<P, Q, B, R, Plugins> {
  return config;
}
