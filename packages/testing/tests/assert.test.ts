import { Axiomify } from '@axiomify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestClient, expectValidResponse, getRoute } from '../src/index';

function buildApp() {
  const app = new Axiomify();
  app.route({
    method: 'GET',
    path: '/users/:id',
    schema: {
      params: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    handler: async (req, res) => {
      const { id } = req.params as { id: string };
      // deliberately bypass dev-mode response validation for the "fail" test
      // by only misbehaving for a specific id
      if (id === 'broken') {
        res.send({ id } as never);
      } else {
        res.send({ id, name: 'Ada' });
      }
    },
  });
  app.route({
    method: 'POST',
    path: '/orders',
    schema: {
      response: {
        201: z.object({ orderId: z.number() }),
        409: z.object({ reason: z.string() }),
      },
    },
    handler: async (req, res) => {
      const conflict = (req.query as Record<string, string>).conflict;
      if (conflict === '1') {
        res.status(409).send({ reason: 'duplicate' });
      } else {
        res.status(201).send({ orderId: 99 });
      }
    },
  });
  app.route({
    method: 'GET',
    path: '/no-schema',
    handler: async (_req, res) => res.send({ anything: true }),
  });
  return app;
}

describe('getRoute', () => {
  it('finds routes by literal registered path', () => {
    const app = buildApp();
    const route = getRoute(app, 'GET', '/users/:id');
    expect(route?.path).toBe('/users/:id');
  });

  it('resolves concrete paths through the router', () => {
    const app = buildApp();
    const route = getRoute(app, 'get', '/users/42');
    expect(route?.path).toBe('/users/:id');
  });

  it('returns undefined for unknown routes and wrong methods', () => {
    const app = buildApp();
    expect(getRoute(app, 'GET', '/missing')).toBeUndefined();
    expect(getRoute(app, 'DELETE', '/users/42')).toBeUndefined();
  });
});

describe('expectValidResponse', () => {
  it('passes and returns the Zod-parsed data for a valid response', async () => {
    const app = buildApp();
    const res = await createTestClient(app).get('/users/42');
    const parsed = expectValidResponse(app, res, {
      method: 'GET',
      path: '/users/:id',
    });
    expect(parsed).toEqual({ id: '42', name: 'Ada' });
  });

  it('accepts concrete paths for parameterised routes', async () => {
    const app = buildApp();
    const res = await createTestClient(app).get('/users/7');
    expect(() =>
      expectValidResponse(app, res, { method: 'get', path: '/users/7' }),
    ).not.toThrow();
  });

  it('throws a rich error when the data violates the schema', () => {
    const app = buildApp();
    // Craft a mismatching capture directly (dev-mode dispatch would have
    // rejected it before it ever reached the wire).
    const fake = { statusCode: 200, data: { id: 42 } };
    expect(() =>
      expectValidResponse(app, fake, { method: 'GET', path: '/users/:id' }),
    ).toThrow(
      /GET \/users\/:id \(status 200\) does not match schema\.response[\s\S]*- id:[\s\S]*- name:[\s\S]*Received data/,
    );
  });

  it('selects the per-status schema from a response map', async () => {
    const app = buildApp();
    const client = createTestClient(app);

    const created = await client.post('/orders');
    expect(
      expectValidResponse(app, created, { method: 'POST', path: '/orders' }),
    ).toEqual({ orderId: 99 });

    const conflicted = await client.post('/orders?conflict=1');
    expect(
      expectValidResponse(app, conflicted, { method: 'POST', path: '/orders' }),
    ).toEqual({ reason: 'duplicate' });
  });

  it('throws when the response map has no schema for the status', () => {
    const app = buildApp();
    expect(() =>
      expectValidResponse(
        app,
        { statusCode: 500, data: null },
        { method: 'POST', path: '/orders' },
      ),
    ).toThrow(/no response schema for status 500.*declared statuses: 201, 409/);
  });

  it('throws when the route has no schema.response', () => {
    const app = buildApp();
    expect(() =>
      expectValidResponse(
        app,
        { statusCode: 200, data: {} },
        { method: 'GET', path: '/no-schema' },
      ),
    ).toThrow(/declares no schema\.response/);
  });

  it('throws (listing registered routes) when the route does not exist', () => {
    const app = buildApp();
    expect(() =>
      expectValidResponse(
        app,
        { statusCode: 200, data: {} },
        { method: 'GET', path: '/ghost' },
      ),
    ).toThrow(/no route registered for GET \/ghost.*GET \/users\/:id/);
  });

  it('lists (none) when the app has no routes at all', () => {
    const app = new Axiomify();
    expect(() =>
      expectValidResponse(
        app,
        { statusCode: 200, data: {} },
        { method: 'GET', path: '/anything' },
      ),
    ).toThrow(/\(none\)/);
  });
});
