import { describe, expect, it } from 'vitest';
import { createTestClient, expectValidResponse } from '@axiomify/testing';
import { app } from '../src/index';

describe('serverless API starter', () => {
  const client = createTestClient(app);

  it('creates an item that satisfies its public response contract', async () => {
    const response = await client.post('/api/v1/items', {
      body: { name: 'Axiomify' },
    });
    expect(response.statusCode).toBe(201);
    expectValidResponse(app, response, {
      method: 'POST',
      path: '/api/v1/items',
    });
  });
});
