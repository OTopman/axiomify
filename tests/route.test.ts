import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { route } from '../src/core/route';
import { AxiomifyPlugin } from '../src/core/types';

describe('Axiomify Core: Route Inference', () => {
  it('infers standard request and response schemas accurately', () => {
    const definedRoute = route({
      method: 'POST',
      path: '/test',
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

  it('infers sequentially injected plugin context perfectly', () => {
    const authPlugin: AxiomifyPlugin<{ user: { id: string } }> = {
      name: 'auth',
      onRequest: () => ({ user: { id: 'user_123' } }),
    };

    route({
      method: 'GET',
      path: '/secure',
      response: z.object({ success: z.boolean() }),
      plugins: [authPlugin], // Changed from 'inject' to 'plugins'
      handler: async (ctx) => {
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: string }>();
        return { success: true };
      },
    });
  });
});
