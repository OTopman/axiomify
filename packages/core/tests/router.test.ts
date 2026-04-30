import { describe, expect, it } from 'vitest';
import { Router } from '../src/router';
import type { RouteDefinition } from '../src/types';

describe('TrieNode Radix Router', () => {
  it('routes exact static paths in O(k) time', () => {
    const router = new Router();

    router.register({
      method: 'GET',
      path: '/api/v1/health',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/api/v1/health');
    expect(match).not.toBeNull();
    expect(match?.route.path).toBe('/api/v1/health');
  });

  it('accurately extracts dynamic parameters', () => {
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

  it('returns null for unmatched routes (404)', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/users',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/does-not-exist');
    expect(match).toBeNull();
  });

  it('returns MethodNotAllowed for a known path with the wrong HTTP method', () => {
    const router = new Router();
    router.register({
      method: 'POST',
      path: '/submit',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('GET', '/submit');
    expect(match).toEqual({
      error: 'MethodNotAllowed',
      allowed: ['POST'],
    });
  });

  it('allows two different methods on the same path without conflict', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/items',
      handler: async () => {},
    } as RouteDefinition);
    router.register({
      method: 'POST',
      path: '/items',
      handler: async () => {},
    } as RouteDefinition);

    expect(router.lookup('GET', '/items')?.route.method).toBe('GET');
    expect(router.lookup('POST', '/items')?.route.method).toBe('POST');
  });

  it('throws on duplicate method + path registration', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/dup',
      handler: async () => {},
    } as RouteDefinition);
    expect(() =>
      router.register({
        method: 'GET',
        path: '/dup',
        handler: async () => {},
      } as RouteDefinition),
    ).toThrow(/already registered/);
  });

  it('allows sibling param routes at the same depth — first registered param name wins', () => {
    // The router intentionally shares a single param trie node for routes like
    // /api/:version/health and /api/:region/status. The first registered param
    // name (:version) is used for all matches at that depth. This is a
    // deliberate design decision: no conflict error is thrown.
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/api/:version/health',
      handler: async () => {},
    } as RouteDefinition);
    router.register({
      method: 'GET',
      path: '/api/:region/status',
      handler: async () => {},
    } as RouteDefinition);

    // Both routes are reachable. The param key is whichever name was registered
    // first (:version), regardless of which route matched.
    const healthMatch = router.lookup('GET', '/api/v1/health');
    expect(healthMatch).not.toBeNull();
    expect(healthMatch?.params).toHaveProperty('version', 'v1');

    const statusMatch = router.lookup('GET', '/api/us-east/status');
    expect(statusMatch).not.toBeNull();
    // :region was registered second — its key at this depth resolves to :version
    expect(statusMatch?.params).toHaveProperty('version', 'us-east');
  });

  it('allows multiple methods on the same param path', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/items/:id',
      handler: async () => {},
    } as RouteDefinition);
    router.register({
      method: 'PUT',
      path: '/items/:id',
      handler: async () => {},
    } as RouteDefinition);

    expect(router.lookup('GET', '/items/42')?.params).toEqual({ id: '42' });
    expect(router.lookup('PUT', '/items/42')?.params).toEqual({ id: '42' });
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

  it('static routes take priority over wildcard at the same depth', () => {
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

    expect(router.lookup('GET', '/files/readme')?.route.path).toBe(
      '/files/readme',
    );
    expect(router.lookup('GET', '/files/unknown.txt')?.route.path).toBe(
      '/files/*',
    );
  });

  it('auto-routes HEAD to GET handler', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/ping',
      handler: async () => {},
    } as RouteDefinition);

    const match = router.lookup('HEAD', '/ping');
    expect(match).not.toBeNull();
    expect(match?.route.method).toBe('GET');
  });

  it('includes HEAD in the Allow list when GET is registered', () => {
    const router = new Router();
    router.register({
      method: 'GET',
      path: '/r',
      handler: async () => {},
    } as RouteDefinition);
    const result = router.lookup('DELETE', '/r');
    expect(result).toMatchObject({ error: 'MethodNotAllowed' });
    expect((result as { allowed: string[] }).allowed).toContain('HEAD');
  });
});
