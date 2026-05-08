import { describe, expect, it } from 'vitest';
import { compiledStates, getCompiledState } from '../src/compiled';
import type { RouteDefinition } from '../src/types';

describe('compiled state WeakMap', () => {
  it('getCompiledState throws when state is absent — framework bug guard', () => {
    const fakeRoute = { method: 'GET', path: '/fake' } as RouteDefinition;
    expect(() => getCompiledState(fakeRoute)).toThrow(
      /No compiled state found for route GET \/fake/,
    );
  });

  it('getCompiledState returns state when present', () => {
    const route = { method: 'GET', path: '/test' } as RouteDefinition;
    const state = { pipeline: [], hasResponseSchema: false };
    compiledStates.set(route, state);
    expect(getCompiledState(route)).toBe(state);
  });

  it('stores state per route instance — separate keys do not collide', () => {
    const route1 = { method: 'GET', path: '/a' } as RouteDefinition;
    const route2 = { method: 'GET', path: '/b' } as RouteDefinition;
    const s1 = { pipeline: [], hasResponseSchema: false };
    const s2 = { pipeline: [], hasResponseSchema: true };
    compiledStates.set(route1, s1);
    compiledStates.set(route2, s2);
    expect(getCompiledState(route1)).toBe(s1);
    expect(getCompiledState(route2)).toBe(s2);
  });
});
