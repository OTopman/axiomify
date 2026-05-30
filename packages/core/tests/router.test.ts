import { describe, expect, it } from 'vitest';
import { Router } from '../src/router';
import type { RouteDefinition } from '../src/types';

function makeRoute(method: any, path: string): RouteDefinition {
  return {
    method,
    path,
    handler: async () => {},
  } as RouteDefinition;
}

describe('Router', () => {
  it('registers and looks up static routes', () => {
    const router = new Router();
    const route = makeRoute('GET', '/users');
    router.register(route);

    const match = router.lookup('GET', '/users');
    expect(match).not.toBeNull();
    if (match && 'route' in match) {
      expect(match.route).toBe(route);
      expect(match.params).toEqual({});
    } else {
      expect.fail('Expected route match');
    }

    expect(router.lookup('GET', '/unknown')).toBeNull();
  });

  it('handles MethodNotAllowed (405)', () => {
    const router = new Router();
    router.register(makeRoute('POST', '/users'));

    const match = router.lookup('GET', '/users');
    expect(match).toEqual({ error: 'MethodNotAllowed', allowed: ['POST'] });
  });

  it('auto-injects HEAD into allowed methods if GET exists', () => {
    const router = new Router();
    router.register(makeRoute('GET', '/users'));

    const match = router.lookup('POST', '/users');
    expect(match).toEqual({
      error: 'MethodNotAllowed',
      allowed: ['GET', 'HEAD'],
    });
  });

  it('handles named parameters', () => {
    const router = new Router();
    const route = makeRoute('GET', '/users/:id/posts/:postId');
    router.register(route);

    const match = router.lookup('GET', '/users/123/posts/456');
    expect(match).not.toBeNull();
    if (match && 'route' in match) {
      expect(match.route).toBe(route);
      expect(match.params).toEqual({ id: '123', postId: '456' });
    } else {
      expect.fail('Expected route match');
    }
  });

  it('handles parameter backtracking', () => {
    const router = new Router();
    // Register a param route first, then a static route that shares a prefix
    router.register(makeRoute('GET', '/:a/b'));
    router.register(makeRoute('GET', '/a/c'));

    const matchStatic = router.lookup('GET', '/a/c');
    expect(matchStatic).not.toBeNull();
    if (matchStatic && 'route' in matchStatic) {
      expect(matchStatic.params).toEqual({});
    }

    const matchParam = router.lookup('GET', '/test/b');
    expect(matchParam).not.toBeNull();
    if (matchParam && 'route' in matchParam) {
      expect(matchParam.params).toEqual({ a: 'test' });
    }
  });

  it('handles multiple identical parameter nodes', () => {
    const router = new Router();
    router.register(makeRoute('GET', '/:id/a'));
    router.register(makeRoute('POST', '/:id/b'));

    const match = router.lookup('POST', '/test/b');
    if (match && 'route' in match) {
      expect(match.params).toEqual({ id: 'test' });
    } else {
      expect.fail('Expected match');
    }
  });

  it('handles wildcards', () => {
    const router = new Router();
    const route = makeRoute('GET', '/assets/*');
    router.register(route);

    const match = router.lookup('GET', '/assets/css/main.css');
    expect(match).not.toBeNull();
    if (match && 'route' in match) {
      expect(match.params).toEqual({ '*': 'css/main.css' });
    } else {
      expect.fail('Expected wildcard match');
    }
  });

  it('throws on invalid wildcard placement', () => {
    const router = new Router();
    expect(() => {
      router.register(makeRoute('GET', '/assets/*/css'));
    }).toThrow(/must be the final path segment/);
  });

  it('throws on route collision', () => {
    const router = new Router();
    router.register(makeRoute('GET', '/collision'));
    expect(() => {
      router.register(makeRoute('GET', '/collision'));
    }).toThrow(/Route collision/);
  });

  it('returns MethodNotAllowed for wildcard routes', () => {
    const router = new Router();
    router.register(makeRoute('POST', '/assets/*'));

    const match = router.lookup('GET', '/assets/css');
    expect(match).toEqual({ error: 'MethodNotAllowed', allowed: ['POST'] });
  });

  it('returns MethodNotAllowed for param routes', () => {
    const router = new Router();
    router.register(makeRoute('POST', '/users/:id'));

    const match = router.lookup('DELETE', '/users/123');
    expect(match).toEqual({ error: 'MethodNotAllowed', allowed: ['POST'] });
  });

  it('resolves HEAD to GET if explicitly missing', () => {
    const router = new Router();
    const route = makeRoute('GET', '/users');
    router.register(route);

    const match = router.lookup('HEAD', '/users');
    expect(match).not.toBeNull();
    if (match && 'route' in match) {
      expect(match.route).toBe(route);
    } else {
      expect.fail();
    }
  });
});
