import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchemaItem } from '../src/types';
import {
  extractRuntimeVariables,
  generateRunnerMarkdownSummary,
  runCollectionBatch,
  validateResponseAgainstSchema,
} from '../src/utils/collection-runner';
import {
  RequestCollection,
  RequestEnvironment,
} from '../src/utils/request-collections';

describe('Collection Runner & Schema Validation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { },
      removeItem: () => { },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('validateResponseAgainstSchema', () => {
    it('should validate object conforming to schema', () => {
      const schema: SchemaItem = {
        method: 'GET',
        path: '/api/v1/users',
        response: {
          type: 'object',
          required: ['id', 'email'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            age: { type: 'number' },
          },
        },
      };

      const validBody = { id: 'usr-123', email: 'user@example.com', age: 30 };
      const res = validateResponseAgainstSchema(validBody, schema);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const schema: SchemaItem = {
        method: 'POST',
        path: '/api/v1/auth/login',
        response: {
          type: 'object',
          required: ['token', 'user'],
        },
      };

      const invalidBody = { token: 'jwt-xyz' };
      const res = validateResponseAgainstSchema(invalidBody, schema);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Missing required field 'user'"))).toBe(true);
    });

    it('should detect field type mismatches', () => {
      const schema: SchemaItem = {
        method: 'GET',
        path: '/api/v1/products',
        response: {
          type: 'object',
          properties: {
            price: { type: 'number' },
          },
        },
      };

      const invalidBody = { price: 'not-a-number' };
      const res = validateResponseAgainstSchema(invalidBody, schema);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("expected type 'number'"))).toBe(true);
    });

    it('should pass cleanly if no response schema is defined', () => {
      const schema: SchemaItem = {
        method: 'DELETE',
        path: '/api/v1/tasks/:id',
      };

      const res = validateResponseAgainstSchema({ success: true }, schema);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe('extractRuntimeVariables', () => {
    it('should extract token and access_token keys automatically', () => {
      const body = {
        access_token: 'bearer-token-12345',
        user: {
          id: 'user-789',
        },
      };

      const vars = extractRuntimeVariables(body);
      const varMap = Object.fromEntries(vars.map((v) => [v.key, v.value]));

      expect(varMap['token']).toBe('bearer-token-12345');
      expect(varMap['access_token']).toBe('bearer-token-12345');
      expect(varMap['id']).toBe('user-789');
    });

    it('should extract Authorization header if present', () => {
      const headers = {
        authorization: 'Bearer jwt-header-secret',
      };

      const vars = extractRuntimeVariables({}, headers);
      const varMap = Object.fromEntries(vars.map((v) => [v.key, v.value]));
      expect(varMap['token']).toBe('jwt-header-secret');
    });
  });

  describe('runCollectionBatch', () => {
    it('should execute collection requests sequentially and pass downstream chained tokens', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'));

        if (body.path.includes('/login')) {
          return {
            ok: true,
            json: async () => ({
              status: 200,
              duration: 25,
              body: { token: 'auth-chain-token', userId: 'usr-999' },
              headers: { 'content-type': 'application/json' },
            }),
          };
        }

        if (body.path.includes('/profile')) {
          const authHeader = body.headers?.['Authorization'] || '';
          return {
            ok: true,
            json: async () => ({
              status: authHeader.includes('auth-chain-token') ? 200 : 401,
              duration: 35,
              body: { name: 'Alex' },
              headers: { 'content-type': 'application/json' },
            }),
          };
        }

        return {
          ok: true,
          json: async () => ({ status: 200, duration: 15, body: {} }),
        };
      });

      vi.stubGlobal('fetch', mockFetch);

      const collection: RequestCollection = {
        id: 'col-auth-suite',
        name: 'Auth & Profile Suite',
        requests: [
          {
            id: 'req-1',
            name: 'Login Request',
            method: 'POST',
            path: '/api/v1/auth/login',
            queryParams: [],
            pathParams: [],
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            bodyMode: 'json',
            body: '{"email":"test@axiomify.dev"}',
            bodyFields: [],
          },
          {
            id: 'req-2',
            name: 'Get User Profile',
            method: 'GET',
            path: '/api/v1/users/profile',
            queryParams: [],
            pathParams: [],
            headers: [
              { key: 'Authorization', value: 'Bearer {{token}}' },
            ],
            bodyMode: 'none',
            body: '',
            bodyFields: [],
          },
        ],
      };

      const environment: RequestEnvironment = {
        id: 'env-test',
        name: 'Testing',
        variables: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
      };

      const progressSpy = vi.fn();

      const report = await runCollectionBatch({
        collection,
        environment,
        autoExtractTokens: true,
        onProgress: progressSpy,
      });

      expect(report.total).toBe(2);
      expect(report.passed).toBe(2);
      expect(report.failed).toBe(0);
      expect(progressSpy).toHaveBeenCalledTimes(2);

      // Verify second request used chained token
      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCallBody.headers['Authorization']).toBe('Bearer auth-chain-token');
    });

    it('should halt execution when stopOnError is enabled and request fails', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          json: async () => ({
            status: 500,
            duration: 40,
            body: { error: 'Internal Server Error' },
          }),
        };
      });

      vi.stubGlobal('fetch', mockFetch);

      const collection: RequestCollection = {
        id: 'col-error',
        name: 'Failing Suite',
        requests: [
          {
            id: 'req-fail',
            name: 'Broken Endpoint',
            method: 'GET',
            path: '/api/broken',
            queryParams: [],
            pathParams: [],
            headers: [],
            bodyMode: 'none',
            body: '',
            bodyFields: [],
          },
          {
            id: 'req-never-reached',
            name: 'Unreachable Endpoint',
            method: 'GET',
            path: '/api/never',
            queryParams: [],
            pathParams: [],
            headers: [],
            bodyMode: 'none',
            body: '',
            bodyFields: [],
          },
        ],
      };

      const report = await runCollectionBatch({
        collection,
        stopOnError: true,
      });

      expect(report.total).toBe(1);
      expect(report.failed).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should execute pre-request and test scripts with variable chaining during batch run', async () => {
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.path === '/api/login') {
          return {
            ok: true,
            json: async () => ({
              status: 200,
              duration: 35,
              body: { token: 'jwt_from_script_xyz', user: 'Bob' },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            status: 200,
            duration: 20,
            body: { success: true },
          }),
        };
      });

      vi.stubGlobal('fetch', mockFetch);

      const collection: RequestCollection = {
        id: 'col-scripts',
        name: 'Scripted Flow',
        requests: [
          {
            id: 'req-login',
            name: 'Login Step',
            method: 'POST',
            path: '/api/login',
            queryParams: [],
            pathParams: [],
            headers: [],
            bodyMode: 'none',
            body: '',
            bodyFields: [],
            preRequestScript: `
              $.request.headers['X-Client'] = 'Axiomify-Studio';
            `,
            testScript: `
              $.test('Login succeeded with token', () => {
                const res = $.response.json();
                $.expect(res.token).toBe('jwt_from_script_xyz');
                $.env.set('bearerToken', res.token);
              });
            `,
          },
          {
            id: 'req-profile',
            name: 'Profile Step',
            method: 'GET',
            path: '/api/profile',
            queryParams: [],
            pathParams: [],
            headers: [{ key: 'Authorization', value: 'Bearer {{bearerToken}}' }],
            bodyMode: 'none',
            body: '',
            bodyFields: [],
            testScript: `
              $.test('Profile request had auth header', () => {
                $.expect($.request.headers['Authorization']).toBe('Bearer jwt_from_script_xyz');
              });
            `,
          },
        ],
      };

      const report = await runCollectionBatch({
        collection,
        autoExtractTokens: false, // script itself extracts the variable!
      });

      expect(report.total).toBe(2);
      expect(report.passed).toBe(2);
      expect(report.failed).toBe(0);

      // Verify request 1 sent header from pre-request script
      const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstCallBody.headers['X-Client']).toBe('Axiomify-Studio');

      // Verify request 2 assertions
      const profileResult = report.results[1];
      expect(profileResult.passed).toBe(true);
      expect(profileResult.assertions.some((a) => a.name === 'Profile request had auth header' && a.passed)).toBe(true);
    });
  });

  describe('generateRunnerMarkdownSummary', () => {
    it('should generate markdown report summary with results table', () => {
      const report = {
        id: 'run-123',
        timestamp: '2026-10-20T12:00:00.000Z',
        collectionId: 'col-1',
        collectionName: 'Order Processing',
        environmentName: 'Local',
        total: 1,
        passed: 1,
        failed: 0,
        totalDurationMs: 42.5,
        avgDurationMs: 42.5,
        results: [
          {
            requestId: 'req-1',
            requestName: 'Create Order',
            method: 'POST',
            path: '/api/orders',
            status: 201 as const,
            duration: 42.5,
            passed: true,
            assertions: [{ name: 'Status 201', passed: true }],
          },
        ],
      };

      const md = generateRunnerMarkdownSummary(report);
      expect(md).toContain('# Collection Test Run: Order Processing');
      expect(md).toContain('100% (1/1 passed, 0 failed)');
      expect(md).toContain('`POST`');
      expect(md).toContain('`/api/orders`');
      expect(md).toContain('✅ Passed');
    });
  });
});
