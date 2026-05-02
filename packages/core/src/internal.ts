import type { AxiomifyRequest, AxiomifyResponse, RouteDefinition } from './types';

export interface CompiledRouteDefinition extends RouteDefinition {
  _compiledPipeline: Array<
    (req: AxiomifyRequest, res: AxiomifyResponse) => Promise<void> | void
  >;
}
