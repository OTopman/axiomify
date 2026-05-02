import type { RouteDefinition } from '@axiomify/core';
import { describe, expect, it } from 'vitest';
import { assertNoNativeSseRoutes } from '../src/sse-guard';

const route = (overrides: Partial<RouteDefinition>): RouteDefinition =>
  ({
    method: 'GET',
    path: '/ok',
    handler: async (_req, res) => res.send({ ok: true }),
    ...overrides,
  }) as RouteDefinition;

describe('Native SSE guard', () => {
  it('allows ordinary routes', () => {
    expect(() => assertNoNativeSseRoutes([route({})])).not.toThrow();
  });

  it('throws for routes declared as SSE', () => {
    expect(() =>
      assertNoNativeSseRoutes([
        route({
          path: '/events',
          sse: true,
        }),
      ]),
    ).toThrow(/NativeAdapter does not support Server-Sent Events.*GET \/events/s);
  });

  it('throws for route handlers that directly call SSE helpers', () => {
    expect(() =>
      assertNoNativeSseRoutes([
        route({
          path: '/live',
          handler: async (_req, res) => {
            res.sseInit();
            res.sseSend({ ok: true });
          },
        }),
      ]),
    ).toThrow(/handler calls `res\.sseInit\(\)`/);
  });

  it('throws for route plugins that directly call SSE helpers', () => {
    expect(() =>
      assertNoNativeSseRoutes([
        route({
          path: '/plugin-live',
          plugins: [
            async (_req, res) => {
              res.sseInit();
            },
          ],
        }),
      ]),
    ).toThrow(/route plugin calls `res\.sseInit\(\)`/);
  });
});
