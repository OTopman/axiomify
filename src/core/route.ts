import { z } from 'zod';
import { AxiomifyPlugin, RouteDefinition } from './types';

export function route<
  P extends z.ZodTypeAny = z.ZodVoid,
  Q extends z.ZodTypeAny = z.ZodVoid,
  B extends z.ZodTypeAny = z.ZodVoid,
  R extends z.ZodTypeAny = z.ZodVoid,
  Plugins extends AxiomifyPlugin<any>[] = AxiomifyPlugin<any>[], // Updated default
>(
  config: RouteDefinition<P, Q, B, R, Plugins>,
): RouteDefinition<P, Q, B, R, Plugins> {
  return config;
}
