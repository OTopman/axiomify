import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { route } from '../src/core/route';
import { testRoute } from '../src/testing';

describe('Axiomify Core API', () => {
  it('strictly infers path parameters and multi-status responses', async () => {
    const definedRoute = route({
      method: 'GET',
      path: '/orgs/:orgId/users/:userId',
      responses: {
        200: z.object({ user: z.string() }),
        404: z.object({ error: z.string() }),
      },
      handler: async (ctx) => {
        // ✨ MAGIC: TypeScript inherently knows orgId and userId exist as strings!
        expectTypeOf(ctx.params).toEqualTypeOf<{
          orgId: string;
          userId: string;
        }>();

        if (ctx.params.userId === 'not_found') {
          return { status: 404, data: { error: 'Missing' } };
        }
        return { status: 200, data: { user: ctx.params.userId } };
      },
    });

    // Verify the return type matches the ResponsesMap strictly
    expectTypeOf(definedRoute.handler).returns.resolves.toEqualTypeOf<
      | { status: 200; data: { user: string } }
      | { status: 404; data: { error: string } }
    >();
  });

  it('executes in-memory tests via testRoute utility', async () => {
    const testableRoute = route({
      method: 'POST',
      path: '/test',
      request: { body: z.object({ value: z.number() }) },
      responses: { 200: z.object({ doubled: z.number() }) },
      handler: async ({ body }) => ({
        status: 200,
        data: { doubled: body.value * 2 },
      }),
    });

    // Executes the entire Zod validation and handler pipeline without an HTTP server
    const result = await testRoute(testableRoute, { body: { value: 10 } });

    expect(result).toEqual({ status: 200, data: { doubled: 20 } });
  });
});
