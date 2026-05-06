import type {
  AxiomifyRequest,
  AxiomifyResponse,
  RouteDefinition,
} from './types';

export interface CompiledRouteDefinition extends RouteDefinition {
  _compiledPipeline: Array<
    (req: AxiomifyRequest, res: AxiomifyResponse) => Promise<void> | void
  >;
  /**
   * True when the route's schema includes a `response` validator.
   * Used by the dispatcher to skip the ValidatingResponse wrapper on routes
   * that have no response schema — avoiding one object allocation per request.
   */
  _hasResponseSchema: boolean;
}
