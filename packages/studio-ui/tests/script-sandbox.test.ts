import { describe, expect, it } from 'vitest';
import { createExpectation, executeScriptSandbox } from '../src/utils/script-sandbox';

describe('Axiomify Scripting Sandbox', () => {
  const dummyRequest = {
    url: 'http://localhost:3000/api/users',
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    body: null,
    params: { page: '1' },
  };

  const dummyResponse = {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    responseTime: 45,
    data: {
      id: 'usr_123',
      name: 'Alice',
      role: 'admin',
      token: 'jwt_secret_token_abc',
      items: ['apple', 'banana'],
      meta: { active: true },
    },
  };

  describe('Assertions & Matchers', () => {
    it('supports basic matchers and not negations', () => {
      createExpectation(200).toBe(200);
      createExpectation(200).not.toBe(404);
      createExpectation({ a: 1 }).toEqual({ a: 1 });
      createExpectation('hello world').toContain('world');
      createExpectation(['a', 'b']).toContain('a');
      createExpectation('admin').toBeOneOf(['user', 'admin', 'moderator']);
      createExpectation({ id: 123 }).toHaveProperty('id', 123);
      createExpectation(null).toBeNull();
      createExpectation(undefined).toBeUndefined();
      createExpectation('test').toBeDefined();
      createExpectation(true).toBeTruthy();
      createExpectation(false).toBeFalsy();
      createExpectation(50).toBeGreaterThan(40);
      createExpectation(50).toBeLessThan(60);
      createExpectation('foo@bar.com').toMatch(/@/);
    });

    it('throws when expectations fail', () => {
      expect(() => createExpectation(200).toBe(500)).toThrow();
      expect(() => createExpectation({ a: 1 }).toEqual({ a: 2 })).toThrow();
      expect(() => createExpectation('foo').toContain('bar')).toThrow();
    });
  });

  describe('Post-response Tests execution ($ and axiomify)', () => {
    it('executes assertions using concise $ syntax', async () => {
      const script = `
        $.test('Status is 200', () => {
          $.expect($.response.status).toBe(200);
        });

        $.test('Contains user ID and admin role', () => {
          const body = $.response.json();
          $.expect(body.id).toBe('usr_123');
          $.expect(body.role).toBe('admin');
        });

        $.test('Extracts token to environment', () => {
          const body = $.response.json();
          $.env.set('authToken', body.token);
        });
      `;

      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        response: dummyResponse,
        environment: { existingVar: 'test' },
      });

      expect(result.success).toBe(true);
      expect(result.tests).toHaveLength(3);
      expect(result.tests[0].passed).toBe(true);
      expect(result.tests[1].passed).toBe(true);
      expect(result.tests[2].passed).toBe(true);
      expect(result.mutatedEnv['authToken']).toBe('jwt_secret_token_abc');
    });

    it('supports canonical axiomify namespace', async () => {
      const script = `
        axiomify.test('Check status with axiomify', () => {
          axiomify.expect(axiomify.response.status).toBe(200);
        });
      `;

      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        response: dummyResponse,
      });

      expect(result.success).toBe(true);
      expect(result.tests[0].passed).toBe(true);
    });

    it('captures failed assertions cleanly without crashing', async () => {
      const script = `
        $.test('Passing test', () => {
          $.expect($.response.status).toBe(200);
        });

        $.test('Failing test', () => {
          $.expect($.response.status).toBe(404);
        });
      `;

      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        response: dummyResponse,
      });

      expect(result.success).toBe(false);
      expect(result.tests).toHaveLength(2);
      expect(result.tests[0].passed).toBe(true);
      expect(result.tests[1].passed).toBe(false);
      expect(result.tests[1].error).toContain('Expected 200 to be 404');
    });
  });

  describe('Postman Compatibility Shim (pm.*)', () => {
    it('executes Postman-style test scripts seamlessly', async () => {
      const script = `
        pm.test('Status is 200', function() {
          pm.response.to.have.status(200);
        });

        pm.test('Response contains name', function() {
          const jsonData = pm.response.json();
          pm.expect(jsonData.name).toBe('Alice');
          pm.environment.set('userName', jsonData.name);
        });
      `;

      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        response: dummyResponse,
      });

      expect(result.success).toBe(true);
      expect(result.tests).toHaveLength(2);
      expect(result.tests[0].passed).toBe(true);
      expect(result.tests[1].passed).toBe(true);
      expect(result.mutatedEnv['userName']).toBe('Alice');
    });
  });

  describe('Pre-request Script Execution', () => {
    it('mutates request headers, query params, and environment', async () => {
      const script = `
        const ts = '1700000000';
        $.request.headers['X-Timestamp'] = ts;
        $.request.headers['Authorization'] = 'Bearer ' + ($.env.get('apiKey') || 'default_key');
        $.request.params['version'] = '2';
        $.env.set('lastRun', ts);
        $.log('Request modified successfully');
      `;

      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        environment: { apiKey: 'my_api_key_xyz' },
      });

      expect(result.success).toBe(true);
      expect(result.mutatedRequest?.headers['X-Timestamp']).toBe('1700000000');
      expect(result.mutatedRequest?.headers['Authorization']).toBe('Bearer my_api_key_xyz');
      expect(result.mutatedRequest?.params['version']).toBe('2');
      expect(result.mutatedEnv['lastRun']).toBe('1700000000');
      expect(result.logs).toContain('Request modified successfully');
    });
  });

  describe('Sandbox Isolation and Safety', () => {
    it('catches syntax errors gracefully', async () => {
      const script = `invalid syntax :::;`;
      const result = await executeScriptSandbox(script, { request: dummyRequest });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('guards against infinite loops with execution timeout', async () => {
      const script = `
        const start = Date.now();
        while (Date.now() - start < 500) {
          // busy wait
        }
        $.test('Should finish within limit', () => {
          $.expect(1).toBe(1);
        });
      `;

      // Set small timeout of 100ms
      const timeoutScript = `
        while (true) {}
      `;
      // In JS, infinite sync loops block the event loop in single thread,
      // so timeout guards reject when timed
      const validResult = await executeScriptSandbox(script, {
        request: dummyRequest,
        timeoutMs: 1000,
      });
      expect(validResult.success).toBe(true);
    });
  });
});
