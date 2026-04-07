import { describe, expect, it } from 'vitest';
import { Router } from '../src/router';
import type { RouteDefinition } from '../src/types';

describe('TrieNode Radix Router', () => {
  it('should route exact static paths in O(k) time', () => {
    const router = new Router();
    const mockHandler = async () => {};

    router.register({
      method: 'GET',
      path: '/api/v1/health',
      handler: mockHandler,
    } as RouteDefinition);

    const match = router.lookup('GET', '/api/v1/health');
    expect(match).not.toBeNull();
    expect(match?.route.path).toBe('/api/v1/health');
  });

  it('should accurately extract dynamic parameters', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/users/:userId/posts/:postId',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/users/123/posts/456');
    expect(match).not.toBeNull();
    expect(match?.params).toEqual({ userId: '123', postId: '456' });
  });

  it('should return null for unmatched routes (404)', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/users',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/does-not-exist');
    expect(match).toBeNull();
  });

  it('should strictly enforce HTTP methods', () => {
    const router = new Router();
    router.register({
      method: 'POST',
      path: '/submit',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/submit');
    // It should not match a GET request on a POST route
    expect(match).toBeNull();
  });
});
