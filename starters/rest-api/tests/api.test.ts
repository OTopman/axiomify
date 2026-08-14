import { describe, expect, it } from 'vitest';
import { createTestClient, expectValidResponse } from '@axiomify/testing';
import { app } from '../src/index';

describe('REST API starter', () => {
  const client = createTestClient(app);

  it('creates a task that satisfies its public response contract', async () => {
    const response = await client.post('/api/v1/tasks', {
      body: { title: 'Ship the API' },
    });

    expect(response.statusCode).toBe(201);
    expectValidResponse(app, response, {
      method: 'POST',
      path: '/api/v1/tasks',
    });
  });
});
