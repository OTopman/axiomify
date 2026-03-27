import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createClient } from '../src/client';

describe('Axiomify Client SDK', () => {
  const routeMap = {
    'users.create': { method: 'POST', path: '/users' },
    'users.getById': { method: 'GET', path: '/users/:id' },
  };

  beforeEach(() => {
    // Reset the global fetch mock before each test
    globalThis.fetch = vi.fn();
  });

  it('builds nested routes and executes basic requests', async () => {
    const mockFetch = vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const api = createClient<any>({ baseUrl: 'http://api.test' }, routeMap);
    const result = await api.users.create({ body: { name: 'Test' } });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.test/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      }),
    );
  });

  it('injects URL parameters accurately', async () => {
    const mockFetch = vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: '123' }),
    } as Response);

    const api = createClient<any>({ baseUrl: 'http://api.test' }, routeMap);
    await api.users.getById({
      params: { id: '123' },
      query: { include: 'posts' },
    });

    // Verifies path param replacement and query string generation
    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.test/users/123?include=posts',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('executes onRequest and onResponse interceptors', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ original: true }),
    } as Response);

    const onRequest = vi.fn((req) => ({
      ...req,
      headers: { Authorization: 'Bearer test' },
    }));
    const onResponse = vi.fn(async (res) => {
      const data = await res.json();
      return {
        ...res,
        json: async () => ({ ...data, intercepted: true }),
      } as Response;
    });

    const api = createClient<any>(
      {
        baseUrl: 'http://api.test',
        interceptors: { onRequest, onResponse },
      },
      routeMap,
    );

    const result = await api.users.create();

    expect(onRequest).toHaveBeenCalled();
    expect(onResponse).toHaveBeenCalled();
    expect(result.intercepted).toBe(true);
  });
});
