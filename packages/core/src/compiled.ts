import type { AxiomifyRequest, AxiomifyResponse, RouteDefinition } from './types';

/**
 * Runtime state produced by {@link RouteRegistry} for each registered route.
 *
 * Previously this was stamped directly onto the user's RouteDefinition object
 * via a type-cast (`definition as CompiledRouteDefinition`). That approach:
 *   - mutated caller-supplied data
 *   - leaked internal fields (`_compiledPipeline`, `_hasResponseSchema`) onto
 *     the user's object reference
 *   - made safe re-registration impossible
 *
 * WeakMap stores compiled state keyed on the route definition object without
 * touching it. The key is the same object reference passed by the user, so
 * GC behaviour is identical to the old approach (the state lives as long as
 * the route definition exists in the registry's `routes` array).
 */
export interface CompiledState {
  /** Ordered array of middleware + handler steps. Built once at registration. */
  pipeline: Array<(req: AxiomifyRequest, res: AxiomifyResponse) => void | Promise<void>>;
  /**
   * True when the route carries a `schema.response` validator.
   * Used by the dispatcher to skip the ValidatingResponse wrapper for the
   * common case (no response schema) — saves one object allocation per request.
   */
  hasResponseSchema: boolean;
}

/**
 * Process-global registry of compiled route state.
 *
 * Keyed on {@link RouteDefinition} object references — the same objects the
 * caller passed to `app.route()`. Because RouteDefinition instances live for
 * the entire process lifetime (held by RouteRegistry), there is no risk of
 * premature collection.
 */
export const compiledStates = new WeakMap<RouteDefinition, CompiledState>();

/**
 * Retrieve compiled state for a matched route. Always present after
 * RouteRegistry.register() — throws in dev if somehow absent (bug guard).
 */
export function getCompiledState(route: RouteDefinition): CompiledState {
  const state = compiledStates.get(route);
  if (!state) {
    throw new Error(
      `[Axiomify] No compiled state found for route ${route.method} ${route.path}. ` +
        'This is a framework bug — please open an issue.',
    );
  }
  return state;
}
