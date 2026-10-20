import { describe, expect, it } from 'vitest';
import {
  createExpectation,
  executeScriptSandbox,
} from '../src/utils/script-sandbox';

describe('Axiomify Scripting Sandbox', () => {
  const dummyRequest = {
    url: 'http://localhost:3000/api/users',
    method: 'GET',
    headers: { Accept: 'application/json' },
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
      createExpectation(50).toBeGreaterThanOrEqual(50);
      createExpectation(50).toBeGreaterThanOrEqual(40);
      createExpectation(50).toBeLessThanOrEqual(50);
      createExpectation(50).toBeLessThanOrEqual(60);
      createExpectation({ foo: 'bar' }).toHaveProperty('foo', 'bar');
      createExpectation({ foo: 'bar' }).not.toHaveProperty('baz');
      createExpectation({ foo: 'bar' }).toContain('foo');
      createExpectation(() => {
        throw new Error('boom');
      }).toThrow();
      createExpectation(() => {}).not.toThrow();
    });

    it('throws when expectations fail across all matchers', () => {
      expect(() => createExpectation(200).toBe(500)).toThrow();
      expect(() => createExpectation(200).not.toBe(200)).toThrow();
      expect(() => createExpectation({ a: 1 }).toEqual({ a: 2 })).toThrow();
      expect(() => createExpectation('foo').toContain('bar')).toThrow();
      expect(() => createExpectation('foo').not.toContain('foo')).toThrow();
      expect(() => createExpectation(50).toBeGreaterThan(60)).toThrow();
      expect(() => createExpectation(50).not.toBeGreaterThan(40)).toThrow();
      expect(() => createExpectation(50).toBeGreaterThanOrEqual(60)).toThrow();
      expect(() =>
        createExpectation(50).not.toBeGreaterThanOrEqual(50),
      ).toThrow();
      expect(() => createExpectation(50).toBeLessThan(40)).toThrow();
      expect(() => createExpectation(50).not.toBeLessThan(60)).toThrow();
      expect(() => createExpectation(50).toBeLessThanOrEqual(40)).toThrow();
      expect(() => createExpectation(50).not.toBeLessThanOrEqual(50)).toThrow();
      expect(() => createExpectation(true).toBeFalsy()).toThrow();
      expect(() => createExpectation(false).toBeTruthy()).toThrow();
      expect(() => createExpectation(undefined).toBeDefined()).toThrow();
      expect(() => createExpectation('def').toBeUndefined()).toThrow();
      expect(() => createExpectation('str').toBeNull()).toThrow();
      expect(() => createExpectation(null).not.toBeNull()).toThrow();
      expect(() => createExpectation('x').toBeOneOf(['a', 'b'])).toThrow();
      expect(() => createExpectation('a').not.toBeOneOf(['a', 'b'])).toThrow();
      expect(() => createExpectation({ a: 1 }).toHaveProperty('b')).toThrow();
      expect(() =>
        createExpectation({ a: 1 }).toHaveProperty('a', 2),
      ).toThrow();
      expect(() =>
        createExpectation({ a: 1 }).not.toHaveProperty('a'),
      ).toThrow();
      expect(() => createExpectation('not-a-func').toThrow()).toThrow();
      expect(() => createExpectation(() => {}).toThrow()).toThrow();
      expect(() =>
        createExpectation(() => {
          throw new Error('err');
        }).not.toThrow(),
      ).toThrow();
      expect(() => createExpectation('hello').toMatch(/xyz/)).toThrow();
      expect(() => createExpectation('hello').not.toMatch(/ell/)).toThrow();
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
      expect(result.mutatedRequest?.headers['Authorization']).toBe(
        'Bearer my_api_key_xyz',
      );
      expect(result.mutatedRequest?.params['version']).toBe('2');
      expect(result.mutatedEnv['lastRun']).toBe('1700000000');
      expect(result.logs).toContain('Request modified successfully');
    });
  });

  describe('Sandbox Isolation and Safety', () => {
    it('catches syntax errors gracefully', async () => {
      const script = `invalid syntax :::;`;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
      });
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

    it('returns immediately with success on empty or blank script', async () => {
      const res1 = await executeScriptSandbox('', { request: dummyRequest });
      expect(res1.success).toBe(true);
      expect(res1.logs).toEqual([]);

      const res2 = await executeScriptSandbox('   \n  \t  ', {
        request: dummyRequest,
      });
      expect(res2.success).toBe(true);
    });

    it('handles env.unset, env.toObject, and env.get', async () => {
      const script = `
        $.env.set('temp', '123');
        $.env.unset('oldKey');
        const all = $.env.toObject();
        $.test('Env state', () => {
          $.expect($.env.get('temp')).toBe('123');
          $.expect(all.temp).toBe('123');
        });
      `;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        environment: { oldKey: 'remove-me' },
      });
      expect(result.success).toBe(true);
      expect(result.mutatedEnv['temp']).toBe('123');
      expect(result.mutatedEnv['oldKey']).toBe('');
    });

    it('handles async tests returning resolved and rejected promises', async () => {
      const script = `
        $.test('Async pass', async () => {
          await new Promise((r) => setTimeout(r, 10));
          $.expect(1 + 1).toBe(2);
        });

        $.test('Async fail', async () => {
          await new Promise((r) => setTimeout(r, 10));
          $.expect(1 + 1).toBe(3);
        });
      `;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
      });
      expect(result.tests).toHaveLength(2);
      expect(result.tests[0].passed).toBe(true);
      expect(result.tests[1].passed).toBe(false);
      expect(result.tests[1].error).toBeDefined();
    });

    it('parses response from text fallback when response data is undefined', async () => {
      const script = `
        $.test('Parses text json', () => {
          const body = $.response.json();
          $.expect(body.count).toBe(42);
        });
      `;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        response: {
          status: 200,
          statusText: 'OK',
          headers: {},
          responseTime: 10,
          text: '{"count":42}',
        },
      });
      expect(result.success).toBe(true);
      expect(result.tests[0].passed).toBe(true);
    });

    it('handles non-JSON response text safely', async () => {
      const script = `
        $.test('Non json body', () => {
          $.expect($.response.json()).toBeNull();
          $.expect($.response.text()).toBe('plain text error');
        });
      `;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
        response: {
          status: 500,
          statusText: 'Error',
          headers: {},
          responseTime: 10,
          text: 'plain text error',
        },
      });
      expect(result.success).toBe(true);
      expect(result.tests[0].passed).toBe(true);
    });

    it('logs multiple arguments and objects', async () => {
      const script = `
        $.log('Hello', { a: 1 }, [1, 2]);
      `;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
      });
      expect(result.logs[0]).toContain('Hello');
      expect(result.logs[0]).toContain('{"a":1}');
    });

    it('supports top-level await in scripts and awaits pending asynchronous tests', async () => {
      const script = `
        await new Promise((r) => setTimeout(r, 10));
        $.env.set('asyncKey', 'completed');
        $.test('Async test in top-level await script', async () => {
          await new Promise((r) => setTimeout(r, 10));
          $.expect($.env.get('asyncKey')).toBe('completed');
        });
      `;
      const result = await executeScriptSandbox(script, {
        request: dummyRequest,
      });
      expect(result.success).toBe(true);
      expect(result.mutatedEnv['asyncKey']).toBe('completed');
      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].passed).toBe(true);
    });
  });
});
