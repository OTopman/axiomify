import { describe, it, expect, vi } from 'vitest';
import {
  generateMockFromSchema,
  runContractTest,
} from '../../src/studio/api/contracts';
import { computeQualityScore } from '../../src/studio/api/quality';
import type { StudioDiscoveryResult } from '../../src/studio/discovery/types';

describe('Studio Contract Testing Center', () => {
  describe('Schema Mock Generator', () => {
    it('should generate valid mock data for basic types', () => {
      expect(generateMockFromSchema({ type: 'string' })).toBe('test_string');
      expect(generateMockFromSchema({ type: 'string', format: 'email' })).toBe(
        'user@example.com',
      );
      expect(generateMockFromSchema({ type: 'string', format: 'uuid' })).toBe(
        '123e4567-e89b-12d3-a456-426614174000',
      );
      expect(generateMockFromSchema({ type: 'number' })).toBe(42);
      expect(generateMockFromSchema({ type: 'boolean' })).toBe(true);
      expect(generateMockFromSchema({ type: 'null' })).toBeNull();
    });

    it('should resolve oneOf/anyOf/allOf and enum', () => {
      expect(
        generateMockFromSchema({ type: 'string', enum: ['first', 'second'] }),
      ).toBe('first');
      expect(
        generateMockFromSchema({
          anyOf: [{ type: 'number', minimum: 10 }, { type: 'string' }],
        }),
      ).toBe(10);
    });

    it('should generate nested arrays and objects', () => {
      const schema = {
        type: 'object',
        properties: {
          username: { type: 'string' },
          roles: {
            type: 'array',
            items: { type: 'string', enum: ['admin', 'user'] },
          },
        },
      };

      const mock = generateMockFromSchema(schema);
      expect(mock).toEqual({
        username: 'test_string',
        roles: ['admin'],
      });
    });
  });

  describe('Contract Executor', () => {
    it('should pass on matching response schema', async () => {
      const mockApp = {
        handle: vi.fn((req, res) => {
          res.status(200).send({ id: 1, name: 'Alice' });
        }),
      };

      const route = {
        method: 'GET',
        path: '/api/test',
        isWs: false,
        validation: [],
        tags: [],
        deprecated: false,
        pluginCount: 0,
        hasResponseSchema: true,
      };

      const schema = {
        routeId: 'GET:/api/test',
        method: 'GET',
        path: '/api/test',
        response: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
      };

      const result = await runContractTest(mockApp, route, schema);
      expect(result.passed).toBe(true);
      expect(result.status).toBe('passed');
      expect(result.violations).toEqual([]);
      expect(result.statusCode).toBe(200);
      expect(result.responseBody).toEqual({ id: 1, name: 'Alice' });
    });

    it('should fail and return violations on mismatching schema', async () => {
      const mockApp = {
        handle: vi.fn((req, res) => {
          res.status(200).send({ id: 'not-a-number', name: 'Alice' });
        }),
      };

      const route = {
        method: 'GET',
        path: '/api/test',
        isWs: false,
        validation: [],
        tags: [],
        deprecated: false,
        pluginCount: 0,
        hasResponseSchema: true,
      };

      const schema = {
        routeId: 'GET:/api/test',
        method: 'GET',
        path: '/api/test',
        response: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
      };

      const result = await runContractTest(mockApp, route, schema);
      expect(result.passed).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain('response/id');
    });

    it('should gracefully handle 401/403 auth blockages', async () => {
      const mockApp = {
        handle: vi.fn((req, res) => {
          res.status(401).send({ error: 'Unauthorized' });
        }),
      };

      const route = {
        method: 'GET',
        path: '/api/protected',
        isWs: false,
        validation: [],
        tags: [],
        deprecated: false,
        pluginCount: 1,
        plugins: ['createAuthPlugin'],
        hasResponseSchema: true,
      };

      const schema = {
        routeId: 'GET:/api/protected',
        method: 'GET',
        path: '/api/protected',
        response: {
          type: 'object',
          properties: {
            secretData: { type: 'string' },
          },
        },
      };

      const result = await runContractTest(mockApp, route, schema);
      expect(result.passed).toBe(true);
      expect(result.status).toBe('passed');
      expect(result.violations[0]).toContain('Request returned 401');
    });
  });
});

describe('Studio API Quality Score', () => {
  it('should compute composite score with expected weights', () => {
    const discovery: StudioDiscoveryResult = {
      routes: [
        {
          method: 'GET',
          path: '/api/users',
          isWs: false,
          validation: [],
          tags: ['users'],
          summary: 'Get all users',
          description: 'Fetches list of users',
          deprecated: false,
          pluginCount: 0,
          hasResponseSchema: true,
        },
      ],
      schemas: [
        {
          routeId: 'GET:/api/users',
          method: 'GET',
          path: '/api/users',
          response: { type: 'array' },
        },
      ],
      hooks: [],
      config: {
        timeout: 0,
        routeConflict: 'throw',
        strictSchema: false,
        httpRouteCount: 1,
        wsRouteCount: 0,
        hookCount: 0,
        serviceCount: 0,
      },
      openapi: null,
      health: {
        findings: [],
        summary: { passes: 1, warnings: 0, failures: 0 },
      },
      discoveredAt: new Date().toISOString(),
    };

    const report = computeQualityScore(discovery, {});
    expect(report.total).toBeGreaterThan(0);
    expect(report.dimensions.schemaCoverage.score).toBe(100);
    expect(report.dimensions.documentation.score).toBe(100);
    expect(report.dimensions.performance.score).toBe(100); // defaults
    expect(report.dimensions.security.score).toBe(100);
    expect(report.dimensions.contractCompliance.score).toBe(100);
    expect(report.total).toBe(100);
  });
});
