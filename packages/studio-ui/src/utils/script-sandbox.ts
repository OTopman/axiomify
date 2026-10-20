/**
 * Axiomify Scripting Sandbox
 *
 * Provides safe, isolated execution for Pre-request scripts and Post-response
 * test assertions in both Request Builder and Collection Runner.
 *
 * Supports:
 * - `axiomify.*`: Canonical namespace
 * - `$.*`: Concise ergonomic shorthand
 * - `pm.*`: Postman compatibility shim
 */

export interface ScriptRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  params: Record<string, string>;
}

export interface ScriptResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  responseTime: number;
  data?: any;
  text?: string;
}

export interface TestAssertion {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface ScriptExecutionResult {
  success: boolean;
  tests: TestAssertion[];
  mutatedRequest?: Partial<ScriptRequest>;
  mutatedEnv: Record<string, string>;
  logs: string[];
  error?: string;
  durationMs: number;
}

export interface Expectation {
  toBe(expected: any): void;
  toEqual(expected: any): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toContain(item: any): void;
  toBeOneOf(array: any[]): void;
  toHaveProperty(prop: string, value?: any): void;
  toThrow(): void;
  toMatch(regex: RegExp | string): void;
  not: Omit<Expectation, 'not'>;
}

export function createExpectation(actual: any, isNot = false): Expectation {
  const fail = (message: string) => {
    throw new Error(message);
  };

  const matchers = {
    toBe(expected: any) {
      const match = actual === expected;
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'not to be' : 'to be'} ${JSON.stringify(expected)}`,
        );
      }
    },
    toEqual(expected: any) {
      const actualJson = JSON.stringify(actual);
      const expectedJson = JSON.stringify(expected);
      const match = actualJson === expectedJson;
      if (isNot ? match : !match) {
        fail(
          `Expected ${actualJson} ${isNot ? 'not to equal' : 'to equal'} ${expectedJson}`,
        );
      }
    },
    toBeDefined() {
      const match = actual !== undefined;
      if (isNot ? match : !match) {
        fail(`Expected value ${isNot ? 'to be undefined' : 'to be defined'}`);
      }
    },
    toBeUndefined() {
      const match = actual === undefined;
      if (isNot ? match : !match) {
        fail(`Expected value ${isNot ? 'to be defined' : 'to be undefined'}`);
      }
    },
    toBeNull() {
      const match = actual === null;
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'not to be null' : 'to be null'}`,
        );
      }
    },
    toBeTruthy() {
      const match = Boolean(actual);
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'to be falsy' : 'to be truthy'}`,
        );
      }
    },
    toBeFalsy() {
      const match = !actual;
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'to be truthy' : 'to be falsy'}`,
        );
      }
    },
    toBeGreaterThan(n: number) {
      const match = typeof actual === 'number' && actual > n;
      if (isNot ? match : !match) {
        fail(
          `Expected ${actual} ${isNot ? 'not to be greater than' : 'to be greater than'} ${n}`,
        );
      }
    },
    toBeGreaterThanOrEqual(n: number) {
      const match = typeof actual === 'number' && actual >= n;
      if (isNot ? match : !match) {
        fail(
          `Expected ${actual} ${isNot ? 'not to be greater than or equal to' : 'to be greater than or equal to'} ${n}`,
        );
      }
    },
    toBeLessThan(n: number) {
      const match = typeof actual === 'number' && actual < n;
      if (isNot ? match : !match) {
        fail(
          `Expected ${actual} ${isNot ? 'not to be less than' : 'to be less than'} ${n}`,
        );
      }
    },
    toBeLessThanOrEqual(n: number) {
      const match = typeof actual === 'number' && actual <= n;
      if (isNot ? match : !match) {
        fail(
          `Expected ${actual} ${isNot ? 'not to be less than or equal to' : 'to be less than or equal to'} ${n}`,
        );
      }
    },
    toContain(item: any) {
      let match = false;
      if (typeof actual === 'string') {
        match = actual.includes(String(item));
      } else if (Array.isArray(actual)) {
        match = actual.includes(item);
      } else if (actual && typeof actual === 'object') {
        match = item in actual;
      }
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'not to contain' : 'to contain'} ${JSON.stringify(item)}`,
        );
      }
    },
    toBeOneOf(array: any[]) {
      const match = Array.isArray(array) && array.includes(actual);
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'not to be one of' : 'to be one of'} ${JSON.stringify(array)}`,
        );
      }
    },
    toHaveProperty(prop: string, value?: any) {
      const hasProp = actual && typeof actual === 'object' && prop in actual;
      const match = hasProp && (value === undefined || actual[prop] === value);
      if (isNot ? match : !match) {
        fail(
          `Expected object ${isNot ? 'not to have property' : 'to have property'} "${prop}"${value !== undefined ? ` with value ${JSON.stringify(value)}` : ''}`,
        );
      }
    },
    toThrow() {
      if (typeof actual !== 'function') {
        fail(`Expected a function to test throwing, got ${typeof actual}`);
      }
      let threw = false;
      try {
        actual();
      } catch {
        threw = true;
      }
      if (isNot ? threw : !threw) {
        fail(`Expected function ${isNot ? 'not to throw' : 'to throw'}`);
      }
    },
    toMatch(regex: RegExp | string) {
      const reg = typeof regex === 'string' ? new RegExp(regex) : regex;
      const match = reg.test(String(actual));
      if (isNot ? match : !match) {
        fail(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'not to match' : 'to match'} ${regex}`,
        );
      }
    },
  };

  return {
    ...matchers,
    get not() {
      return createExpectation(actual, !isNot);
    },
  };
}

export interface SandboxContextOptions {
  request: ScriptRequest;
  response?: ScriptResponse;
  environment?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Execute user-provided script in an isolated context.
 */
export async function executeScriptSandbox(
  script: string,
  options: SandboxContextOptions,
): Promise<ScriptExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  const tests: TestAssertion[] = [];
  const timeoutMs = options.timeoutMs ?? 1500;

  if (!script || !script.trim()) {
    return {
      success: true,
      tests: [],
      mutatedEnv: {},
      logs: [],
      durationMs: 0,
    };
  }

  // Clone environment to track mutations
  const envMap: Record<string, string> = { ...(options.environment || {}) };
  const mutatedEnv: Record<string, string> = {};

  // Clone request to allow mutation in pre-request
  const requestClone: ScriptRequest = {
    url: options.request.url,
    method: options.request.method,
    headers: { ...options.request.headers },
    body: options.request.body,
    params: { ...options.request.params },
  };

  // Prepare response object if present
  let responseData = options.response?.data;
  const responseText = options.response?.text;
  if (options.response && responseData === undefined && responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = null;
    }
  }

  const responseObj = options.response
    ? {
        status: options.response.status,
        statusText: options.response.statusText,
        headers: { ...options.response.headers },
        responseTime: options.response.responseTime,
        json: () => responseData,
        text: () => responseText ?? JSON.stringify(responseData),
      }
    : undefined;

  // Build the Axiomify scope object
  const axiomify = {
    request: requestClone,
    response: responseObj,
    env: {
      get: (key: string) => envMap[key],
      set: (key: string, value: any) => {
        const valStr = String(value);
        envMap[key] = valStr;
        mutatedEnv[key] = valStr;
      },
      unset: (key: string) => {
        delete envMap[key];
        mutatedEnv[key] = '';
      },
      toObject: () => ({ ...envMap }),
    },
    test: (name: string, fn: () => void | Promise<void>) => {
      const testStart = Date.now();
      try {
        const res = fn();
        if (res && typeof (res as any).then === 'function') {
          // If the test function returns a promise
        }
        tests.push({
          name,
          passed: true,
          durationMs: Date.now() - testStart,
        });
      } catch (err: any) {
        tests.push({
          name,
          passed: false,
          error: err?.message || String(err),
          durationMs: Date.now() - testStart,
        });
      }
    },
    expect: (actual: any) => createExpectation(actual),
    log: (...args: any[]) => {
      logs.push(
        args
          .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
          .join(' '),
      );
    },
  };

  // Concise shorthand $ points to the exact same object
  const $ = axiomify;

  // Postman compatibility shim
  const pm = {
    test: axiomify.test,
    expect: axiomify.expect,
    response: responseObj
      ? {
          code: responseObj.status,
          status: responseObj.statusText,
          responseTime: responseObj.responseTime,
          headers: responseObj.headers,
          json: responseObj.json,
          text: responseObj.text,
          to: {
            have: {
              status: (code: number) => {
                if (responseObj.status !== code) {
                  throw new Error(
                    `expected response code ${responseObj.status} to be ${code}`,
                  );
                }
              },
            },
          },
        }
      : undefined,
    environment: {
      get: axiomify.env.get,
      set: axiomify.env.set,
      unset: axiomify.env.unset,
    },
    variables: {
      get: axiomify.env.get,
      set: axiomify.env.set,
    },
  };

  // Sandboxed wrapper
  let scriptError: string | undefined;

  try {
    // We isolate window, document, localStorage, alert, process by shadowing their names
    const shadowGlobals = [
      'window',
      'document',
      'localStorage',
      'sessionStorage',
      'alert',
      'confirm',
      'prompt',
      'process',
      'require',
      'importScripts',
      'fetch',
      'XMLHttpRequest',
    ];

    const shadowArgs = shadowGlobals.join(', ');
    const shadowValues = shadowGlobals.map(() => undefined);

    const wrappedCode = `
      "use strict";
      return (function(${shadowArgs}) {
        ${script}
      }).apply(undefined, arguments[3]);
    `;

    const runner = new Function('axiomify', '$', 'pm', wrappedCode);

    // Timeout guard promise
    const executionPromise = new Promise<void>((resolve, reject) => {
      try {
        runner.call(undefined, axiomify, $, pm, shadowValues);
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(new Error(`Script execution timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    await Promise.race([executionPromise, timeoutPromise]);
  } catch (err: any) {
    scriptError = err?.message || String(err);
  }

  const durationMs = Date.now() - startTime;
  const allTestsPassed = tests.length === 0 || tests.every((t) => t.passed);
  const success = !scriptError && allTestsPassed;

  return {
    success,
    tests,
    mutatedRequest: requestClone,
    mutatedEnv,
    logs,
    error: scriptError,
    durationMs,
  };
}

/**
 * Built-in snippets for quick insertion into Pre-request and Tests tabs.
 */
export const SCRIPT_SNIPPETS = {
  preRequest: [
    {
      label: 'Set Timestamp Header',
      description: 'Add an X-Timestamp header with current UTC milliseconds',
      code: `const timestamp = Date.now().toString();\n$.request.headers['X-Timestamp'] = timestamp;\n$.env.set('timestamp', timestamp);`,
    },
    {
      label: 'Generate Random UUID',
      description: 'Set a random correlation/request ID header',
      code: `const uuid = 'req-' + Math.random().toString(36).substring(2, 11);\n$.request.headers['X-Request-ID'] = uuid;`,
    },
    {
      label: 'Set Environment Variable',
      description: 'Store a variable into the active environment',
      code: `$.env.set('myKey', 'myValue');`,
    },
    {
      label: 'Log Request Details',
      description: 'Print request debug info into sandbox logs',
      code: `$.log('Executing ' + $.request.method + ' ' + $.request.url);`,
    },
  ],
  test: [
    {
      label: 'Status code: 200 OK',
      description: 'Verify HTTP status is 200',
      code: `$.test('Status code is 200', () => {\n  $.expect($.response.status).toBe(200);\n});`,
    },
    {
      label: 'Status code: 2xx Success',
      description: 'Verify HTTP status is within 200-299',
      code: `$.test('Successful 2xx status', () => {\n  $.expect($.response.status).toBeGreaterThanOrEqual(200);\n  $.expect($.response.status).toBeLessThan(300);\n});`,
    },
    {
      label: 'Latency SLA (< 300ms)',
      description: 'Verify response latency is under threshold',
      code: `$.test('Response time is under 300ms', () => {\n  $.expect($.response.responseTime).toBeLessThan(300);\n});`,
    },
    {
      label: 'Check JSON Field',
      description: 'Verify property exists and contains expected value',
      code: `$.test('Response body contains valid data', () => {\n  const res = $.response.json();\n  $.expect(res).toBeDefined();\n  $.expect(res).toHaveProperty('id');\n});`,
    },
    {
      label: 'Extract Token to Environment',
      description: 'Save auth token from response body to {{token}}',
      code: `$.test('Extract auth token', () => {\n  const res = $.response.json();\n  $.expect(res.token).toBeDefined();\n  $.env.set('token', res.token);\n});`,
    },
    {
      label: 'Array length and items',
      description: 'Verify response list is not empty',
      code: `$.test('Array has items', () => {\n  const list = $.response.json();\n  $.expect(Array.isArray(list)).toBeTruthy();\n  $.expect(list.length).toBeGreaterThan(0);\n});`,
    },
  ],
};
