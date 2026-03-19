import { z } from "zod";
import { RouteDefinition } from "./types";

/**
 * The Axiomify Route Builder.
 * * @param config The route configuration including Zod schemas and the handler.
 * @returns The exact same configuration object, but with strictly inferred types.
 */
export function route<
  P extends z.ZodTypeAny = z.ZodVoid,
  Q extends z.ZodTypeAny = z.ZodVoid,
  B extends z.ZodTypeAny = z.ZodVoid,
  R extends z.ZodTypeAny = z.ZodVoid,
>(config: RouteDefinition<P, Q, B, R>): RouteDefinition<P, Q, B, R> {
  // This function exists purely for
  // Developer Experience (DX) and TypeScript inference at build time.
  return config;
}
