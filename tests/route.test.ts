import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import { route } from "../src/core/route";
import { Plugin } from "../src/core/types";

describe("Axiomify Core: Route Inference", () => {
  it("infers standard request and response schemas accurately", () => {
    const definedRoute = route({
      method: "POST",
      path: "/test",
      request: {
        body: z.object({ email: z.string() }),
      },
      response: z.object({ id: z.number() }),
      handler: async (ctx) => {
        // 1. Compile-time test: Ensure `ctx.body` is strictly inferred
        expectTypeOf(ctx.body).toEqualTypeOf<{ email: string }>();

        // 2. Compile-time test: Ensure missing properties are typed as void/undefined
        expectTypeOf(ctx.query).toBeUnknown();

        return { id: 1 };
      },
    });

    // 3. Compile-time test: Ensure the handler's return type matches the response schema
    type ExpectedReturnType = Promise<{ id: number }> | { id: number };
    expectTypeOf(
      definedRoute.handler,
    ).returns.toEqualTypeOf<ExpectedReturnType>();
  });

  it("infers sequentially injected plugin context perfectly", () => {
    // Define two distinct plugins
    const authPlugin: Plugin<{ user: { id: string } }> = (req) => ({
      user: { id: "user_123" },
    });

    const dbPlugin: Plugin<{ db: { query: () => void } }> = (req) => ({
      db: { query: () => {} },
    });

    route({
      method: "GET",
      path: "/secure",
      response: z.object({ success: z.boolean() }),
      // Inject both plugins
      inject: [authPlugin, dbPlugin],
      handler: async (ctx) => {
        // The Magic: Assert that both `user` and `db` exist on the context object
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.db).toEqualTypeOf<{ query: () => void }>();

        return { success: true };
      },
    });
  });
});
