import { describe, expect, it } from 'vitest';
import { Axiomify } from '../src/app';
import { createDeprecationPlugin } from '../src/deprecation';
import { createTestClient } from '@axiomify/testing';

describe('createDeprecationPlugin', () => {
  it('emits RFC lifecycle headers before the handler response', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/v1/users',
      schema: { deprecated: true },
      plugins: [
        createDeprecationPlugin({
          deprecatedAt: '2026-01-15T00:00:00.000Z',
          sunset: '2026-06-01T00:00:00.000Z',
          successor: 'https://api.example.com/v2/users',
        }),
      ],
      handler: (_req, res) => res.send({ users: [] }),
    });

    const response = await createTestClient(app).get('/v1/users');
    expect(response.headers.deprecation).toBe('@1768435200');
    expect(response.headers.sunset).toBe('Mon, 01 Jun 2026 00:00:00 GMT');
    expect(response.headers.link).toBe(
      '<https://api.example.com/v2/users>; rel="successor-version"',
    );
  });

  it('uses a structured boolean when no deprecation date is supplied', async () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/',
      plugins: [createDeprecationPlugin()],
      handler: (_req, res) => res.send({ ok: true }),
    });

    const response = await createTestClient(app).get('/');
    expect(response.headers.deprecation).toBe('?1');
  });

  it('rejects invalid dates and successor URLs at startup', () => {
    expect(() => createDeprecationPlugin({ sunset: 'not a date' })).toThrow(
      'Invalid sunset date',
    );
    expect(() => createDeprecationPlugin({ successor: '/v2/users' })).toThrow(
      'must be an absolute URL',
    );
  });
});
