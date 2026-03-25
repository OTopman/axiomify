import { describe, expectTypeOf, it, expect } from 'vitest';
import { z } from 'zod';
import { route } from '../src/core/route';
import { AxiomifyPlugin } from '../src/core/types';
import { AxiomifyError } from '../src/core/error';

describe('Axiomify Core: Strict Type Inference & Validation', () => {
  it('infers standard request payload boundaries correctly', () => {
    const definedRoute = route({
      method: 'POST',
      path: '/test',
      request: {
        body: z.object({ email: z.string().email() }),
        query: z.object({ includeDetails: z.boolean() }),
      },
      response: z.object({ id: z.number() }),
      handler: async (ctx) => {
        // Compile-time tests: Ensure standard payloads are strictly typed
        expectTypeOf(ctx.body).toEqualTypeOf<{ email: string }>();
        expectTypeOf(ctx.query).toEqualTypeOf<{ includeDetails: boolean }>();

        // Compile-time test: Missing properties must fall back to void
        expectTypeOf(ctx.params).toEqualTypeOf<void>();

        return { id: 1 };
      },
    });

    // Compile-time test: Ensure the handler strictly enforces the response schema
    type ExpectedReturnType = Promise<{ id: number }> | { id: number };
    expectTypeOf(
      definedRoute.handler,
    ).returns.toEqualTypeOf<ExpectedReturnType>();
  });

  it('infers complex, multi-plugin context merging accurately', () => {
    // 1. Define distinct plugins with explicitly typed injected context
    const authPlugin: AxiomifyPlugin<{
      user: { id: string; role: 'admin' | 'user' };
    }> = {
      name: 'auth',
      onRequest: () => ({ user: { id: 'usr_123', role: 'admin' } }),
    };

    const dbPlugin: AxiomifyPlugin<{ db: { connected: boolean } }> = {
      name: 'db',
      onRequest: () => ({ db: { connected: true } }),
    };

    route({
      method: 'GET',
      path: '/secure-data',
      response: z.object({ success: z.boolean() }),

      // 2. Inject multiple plugins as a tuple
      plugins: [authPlugin, dbPlugin] as const,

      handler: async (ctx) => {
        // 3. Compile-time magic: Ensure the context deeply merges all injected data!
        expectTypeOf(ctx.user).toEqualTypeOf<{
          id: string;
          role: 'admin' | 'user';
        }>();
        expectTypeOf(ctx.db).toEqualTypeOf<{ connected: boolean }>();

        // Verify standard HTTP properties are still intact
        expectTypeOf(ctx.headers).toEqualTypeOf<
          Record<string, string | string[] | undefined>
        >();

        return { success: true };
      },
    });
  });

  it('standardizes framework errors via AxiomifyError', () => {
    // Runtime test for the new Error system
    const notFoundError = AxiomifyError.NotFound('User not found in database');

    expect(notFoundError).toBeInstanceOf(Error);
    expect(notFoundError.name).toBe('AxiomifyError');
    expect(notFoundError.code).toBe('NOT_FOUND');
    expect(notFoundError.statusCode).toBe(404);
    expect(notFoundError.message).toBe('User not found in database');

    const complexError = AxiomifyError.BadRequest('Invalid state', {
      attempt: 3,
    });
    expect(complexError.statusCode).toBe(400);
    expect(complexError.metadata).toEqual({ attempt: 3 });
  });
});
