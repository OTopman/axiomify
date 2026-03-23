import { z } from 'zod';
import { AxiomifyPlugin, RouteDefinition } from './types';

/**
 * The Axiomify Route Builder.
 * @param config The route configuration including Zod schemas and the handler.
 * @returns The exact same configuration object, but with strictly inferred types.
 */
export function route<
  P extends z.ZodTypeAny = z.ZodVoid,
  Q extends z.ZodTypeAny = z.ZodVoid,
  B extends z.ZodTypeAny = z.ZodVoid,
  R extends z.ZodTypeAny = z.ZodVoid,
  Plugins extends AxiomifyPlugin<any>[] = [], // 1. Add the Plugins generic
>(
  config: RouteDefinition<P, Q, B, R, Plugins>, // 2. Pass it into the RouteDefinition
): RouteDefinition<P, Q, B, R, Plugins> {
  // 3. Return it explicitly
  return config;
}
