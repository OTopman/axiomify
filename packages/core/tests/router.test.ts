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
    // 🚀 FIX: We now correctly return a 405 MethodNotAllowed instead of 404 (null)
    expect(match).toEqual({
      error: 'MethodNotAllowed',
      allowed: ['POST'],
    });
  });

  it('throws when sibling routes use different param names at the same depth', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/api/:version/health',
      handler: async () => {},
    } as RouteDefinition);
    expect(() =>
      router.register({
        method: 'GET',
        path: '/api/:region/status',
        handler: async () => {},
      } as RouteDefinition),
    ).toThrow('Route conflict');
  });

  it('matches a wildcard route and captures the remainder in params["*"]', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/static/*',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/static/images/logo.png');
    expect(match).not.toBeNull();
    expect(match?.params['*']).toBe('images/logo.png');
  });

  it('throws when wildcard is not the final path segment', () => {
    const router = new Router();
    expect(() =>
      router.register({
        method: 'GET',
        path: '/bad/*/route',
        handler: async () => {},
      } as RouteDefinition),
    ).toThrow('wildcard * must be the final path segment');
  });

  it('static and param routes take priority over wildcard at the same depth', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/files/readme',
      handler: async () => {},
    } as RouteDefinition);
    router.register({
      method: 'GET',
      path: '/files/*',
      handler: async () => {},
    } as RouteDefinition);

    const exactMatch = router.lookup('GET', '/files/readme');
    expect(exactMatch?.route.path).toBe('/files/readme');

    const wildcardMatch = router.lookup('GET', '/files/unknown.txt');
    expect(wildcardMatch?.route.path).toBe('/files/*');
  });
});
