import { describe, expect, it } from 'vitest';
import { RouteItem } from '../src/types';
import {
  extractAllTags,
  extractMethodCounts,
  filterRoutes,
  getRouteMetadata,
} from '../src/utils/route-discovery-helper';

describe('Route Discovery Helper', () => {
  const sampleRoutes: RouteItem[] = [
    {
      method: 'GET',
      path: '/api/v1/users',
      tags: ['users'],
      summary: 'List users',
      description: 'Returns a paginated list of registered users.',
      validation: ['query'],
    },
    {
      method: 'POST',
      path: '/api/v1/users',
      tags: ['users', 'auth'],
      summary: 'Create user',
      description: 'Registers a new user account with credentials.',
      validation: ['body'],
    },
    {
      method: 'GET',
      path: '/api/v1/users/:id',
      tags: ['users'],
      summary: 'Get user by ID',
      description: 'Fetches detailed profile information for a single user.',
      validation: ['params'],
    },
    {
      method: 'DELETE',
      path: '/api/v1/users/:id',
      tags: ['users', 'admin'],
      summary: 'Delete user',
      description: 'Permanently removes a user account.',
      validation: ['params'],
    },
    {
      method: 'GET',
      path: '/api/v1/health',
      tags: ['system'],
      summary: 'Health check',
      description: 'Liveness probe endpoint.',
      validation: [],
    },
    {
      method: 'WS',
      path: '/ws/chat',
      isWs: true,
      tags: ['realtime'],
      validation: [],
    },
  ];

  it('extracts metadata from route item and fallbacks to openapi if needed', () => {
    const routeWithoutDirectMeta: RouteItem = {
      method: 'GET',
      path: '/api/v1/orders',
      validation: [],
    };

    const mockOpenApi = {
      paths: {
        '/api/v1/orders': {
          get: {
            summary: 'List orders from OpenAPI',
            description: 'Returns orders from store.',
            tags: ['orders'],
            operationId: 'listOrders',
          },
        },
      },
    };

    const meta = getRouteMetadata(routeWithoutDirectMeta, mockOpenApi);
    expect(meta.summary).toBe('List orders from OpenAPI');
    expect(meta.description).toBe('Returns orders from store.');
    expect(meta.tags).toEqual(['orders']);
    expect(meta.operationId).toBe('listOrders');
  });

  it('filters routes by search query matching summary, description, tags, and path', () => {
    // Search by summary
    const resSummary = filterRoutes(sampleRoutes, { query: 'paginated' });
    expect(resSummary).toHaveLength(1);
    expect(resSummary[0].path).toBe('/api/v1/users');
    expect(resSummary[0].method).toBe('GET');

    // Search by tag
    const resTag = filterRoutes(sampleRoutes, { query: 'admin' });
    expect(resTag).toHaveLength(1);
    expect(resTag[0].method).toBe('DELETE');

    // Search by path segment
    const resPath = filterRoutes(sampleRoutes, { query: ':id' });
    expect(resPath).toHaveLength(2);

    // Search by description
    const resDesc = filterRoutes(sampleRoutes, { query: 'credentials' });
    expect(resDesc).toHaveLength(1);
    expect(resDesc[0].method).toBe('POST');
  });

  it('filters routes by HTTP method', () => {
    const postRoutes = filterRoutes(sampleRoutes, { method: 'POST' });
    expect(postRoutes).toHaveLength(1);
    expect(postRoutes[0].path).toBe('/api/v1/users');

    const getRoutes = filterRoutes(sampleRoutes, { method: 'GET' });
    expect(getRoutes).toHaveLength(3); // users, users/:id, health (excludes WS)
  });

  it('filters routes by specific tag', () => {
    const authRoutes = filterRoutes(sampleRoutes, { tag: 'auth' });
    expect(authRoutes).toHaveLength(1);
    expect(authRoutes[0].method).toBe('POST');
  });

  it('extracts unique tags with counts sorted by popularity', () => {
    const tags = extractAllTags(sampleRoutes);
    expect(tags).toEqual([
      { tag: 'users', count: 4 },
      { tag: 'admin', count: 1 },
      { tag: 'auth', count: 1 },
      { tag: 'system', count: 1 },
    ]);
  });

  it('extracts method counts accurately', () => {
    const counts = extractMethodCounts(sampleRoutes);
    expect(counts.ALL).toBe(5); // 5 non-WS routes
    expect(counts.GET).toBe(3);
    expect(counts.POST).toBe(1);
    expect(counts.DELETE).toBe(1);
    expect(counts.PUT).toBe(0);
  });
});
