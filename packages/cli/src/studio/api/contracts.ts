import type { ServerResponse } from 'node:http';
import type { DiscoveredRoute, DiscoveredSchema, StudioDiscoveryResult } from '../discovery/types';
import { sendJson } from '../server/http-server';
import { logCorrelationStorage } from './logs';

export interface ContractTestResult {
  routeId: string;
  route: string;
  method: string;
  passed: boolean;
  status: 'passed' | 'failed' | 'missing-schema' | 'not-run';
  violations: string[];
  timestamp: string;
  statusCode?: number;
  requestPayload?: any;
  responseBody?: any;
  responseHeaders?: Record<string, string>;
}

let contractResults: ContractTestResult[] = [];
let autoRun = true;
let onContractsUpdatedCb: (() => void) | null = null;

export function setOnContractsUpdated(cb: () => void): void {
  onContractsUpdatedCb = cb;
}

export function notifyContractsUpdated(): void {
  onContractsUpdatedCb?.();
}

export function setContractsAutoRun(val: boolean): void {
  autoRun = val;
}

export function getContractsAutoRun(): boolean {
  return autoRun;
}

export function getContractResults(): ContractTestResult[] {
  return contractResults;
}

/**
 * Generates a mock payload conforming to a JSON Schema.
 */
export function generateMockFromSchema(schema: any, depth = 0): any {
  if (depth > 10) return undefined;
  if (!schema) return undefined;

  // Resolve anyOf / oneOf / allOf
  if (schema.anyOf && schema.anyOf.length > 0) {
    return generateMockFromSchema(schema.anyOf[0], depth + 1);
  }
  if (schema.oneOf && schema.oneOf.length > 0) {
    return generateMockFromSchema(schema.oneOf[0], depth + 1);
  }
  if (schema.allOf && schema.allOf.length > 0) {
    const merged = {};
    for (const sub of schema.allOf) {
      Object.assign(merged, generateMockFromSchema(sub, depth + 1));
    }
    return merged;
  }

  let type = schema.type;
  if (Array.isArray(type)) {
    type = type.find((t) => t !== 'null') || type[0];
  }
  if (!type) {
    if (schema.properties) type = 'object';
    else if (schema.items) type = 'array';
  }

  if (type === 'string') {
    if (schema.format === 'date-time') {
      return new Date().toISOString();
    }
    if (schema.format === 'email') {
      return 'user@example.com';
    }
    if (schema.format === 'uuid') {
      return '123e4567-e89b-12d3-a456-426614174000';
    }
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }
    return 'test_string';
  }

  if (type === 'number' || type === 'integer') {
    if (schema.minimum !== undefined) {
      return schema.minimum;
    }
    return 42;
  }

  if (type === 'boolean') {
    return true;
  }

  if (type === 'null') {
    return null;
  }

  if (type === 'array') {
    const minItems = schema.minItems ?? 1;
    const result = [];
    for (let i = 0; i < minItems; i++) {
      result.push(generateMockFromSchema(schema.items, depth + 1));
    }
    return result;
  }

  if (type === 'object') {
    const result: Record<string, any> = {};
    const props = schema.properties || {};
    for (const [key, prop] of Object.entries(props)) {
      result[key] = generateMockFromSchema(prop, depth + 1);
    }
    return result;
  }

  return undefined;
}

/**
 * Validates a body against a JSON Schema using Ajv.
 */
function validateResponse(
  schema: any,
  body: any,
): { passed: boolean; violations: string[] } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AjvClass = require('ajv/dist/2020');
    const ajv = new AjvClass({
      strict: false,
      allErrors: true,
    });
    const validate = ajv.compile(schema);
    const valid = validate(body);
    if (!valid) {
      const violations = (validate.errors || []).map((err: any) => {
        const path = err.instancePath ? `response${err.instancePath}` : 'response';
        return `${path}: ${err.message}`;
      });
      return { passed: false, violations };
    }
    return { passed: true, violations: [] };
  } catch (err: any) {
    return {
      passed: false,
      violations: [`Schema compilation error: ${err.message}`],
    };
  }
}

/**
 * Execute in-memory mock request.
 */
async function mockRequest(
  app: any,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: any,
): Promise<{ status: number; headers: Record<string, string>; body?: string } | null> {
  return new Promise((resolve) => {
    let responseStatus = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody = '';

    const req: any = {
      id: `studio-contract-${Date.now()}`,
      method: method.toUpperCase(),
      url: path,
      path,
      headers: {
        host: 'localhost',
        'content-type': 'application/json',
        ...headers,
      },
      state: {},
      signal: { addEventListener: () => { } },
      on: (event: string, callback: any) => {
        if (event === 'data' && body) {
          callback(Buffer.from(JSON.stringify(body)));
        }
        if (event === 'end') {
          callback();
        }
      },
    };

    const res: any = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      header(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return this;
      },
      send(data: any) {
        responseBody = typeof data === 'object' ? JSON.stringify(data) : String(data);
        resolve({
          status: responseStatus,
          headers: responseHeaders,
          body: responseBody,
        });
      },
      getHeader(name: string) {
        return responseHeaders[name.toLowerCase()];
      },
      removeHeader(name: string) {
        delete responseHeaders[name.toLowerCase()];
      },
    };

    try {
      logCorrelationStorage.run(req.id, () => {
        app.handle(req, res);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Runs a contract test against a single route.
 */
export async function runContractTest(
  app: any,
  route: DiscoveredRoute,
  schema: DiscoveredSchema,
): Promise<ContractTestResult> {
  const routeId = `${route.method}:${route.path}`;

  if (!schema || !schema.response) {
    return {
      routeId,
      route: route.path,
      method: route.method,
      passed: false,
      status: 'missing-schema',
      violations: ['No response schema defined on this route.'],
      timestamp: new Date().toISOString(),
    };
  }

  // 1. Build path with mock params
  let targetPath = route.path;
  const paramMatches = targetPath.match(/:[a-zA-Z0-9_]+/g);
  if (paramMatches) {
    const mockParams = schema.params ? generateMockFromSchema(schema.params) : {};
    for (const match of paramMatches) {
      const key = match.slice(1);
      const val = mockParams[key] !== undefined ? mockParams[key] : '1';
      targetPath = targetPath.replace(match, String(val));
    }
  }

  // 2. Build query parameters
  if (schema.query) {
    const mockQuery = generateMockFromSchema(schema.query);
    if (mockQuery && typeof mockQuery === 'object') {
      const qParts = [];
      for (const [k, v] of Object.entries(mockQuery)) {
        if (v !== undefined) {
          qParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
        }
      }
      if (qParts.length > 0) {
        targetPath += '?' + qParts.join('&');
      }
    }
  }

  // 3. Build request body
  let requestPayload: any = undefined;
  if (schema.body) {
    requestPayload = generateMockFromSchema(schema.body);
  }

  // 4. Send request
  try {
    const res = await mockRequest(app, route.method, targetPath, {}, requestPayload);
    if (!res) {
      return {
        routeId,
        route: route.path,
        method: route.method,
        passed: false,
        status: 'failed',
        violations: ['Mock request execution failed.'],
        timestamp: new Date().toISOString(),
      };
    }

    const statusCode = res.status;
    const responseHeaders = res.headers;
    let responseBody: any = null;
    try {
      responseBody = res.body ? JSON.parse(res.body) : null;
    } catch {
      responseBody = res.body;
    }

    // Resolve matching schema
    let matchingSchema: any = null;
    const rawResponseSchema = schema.response;

    // Check if the response schema is a status-code mapping
    const isMapping =
      rawResponseSchema &&
      typeof rawResponseSchema === 'object' &&
      !('type' in rawResponseSchema) &&
      !('anyOf' in rawResponseSchema) &&
      !('oneOf' in rawResponseSchema) &&
      !('allOf' in rawResponseSchema);

    if (isMapping) {
      matchingSchema = (rawResponseSchema as Record<string, any>)[String(statusCode)];
    } else {
      // If not mapping, it's the direct schema for success (2xx)
      if (statusCode >= 200 && statusCode < 300) {
        matchingSchema = rawResponseSchema;
      }
    }

    // If request blocked by authentication and no specific error schema exists
    const hasAuthPlugin =
      route.plugins &&
      route.plugins.some(
        (p) => p.toLowerCase().includes('auth') || p.toLowerCase().includes('jwt'),
      );
    if ((statusCode === 401 || statusCode === 403) && !matchingSchema && hasAuthPlugin) {
      return {
        routeId,
        route: route.path,
        method: route.method,
        passed: true,
        status: 'passed',
        violations: [
          `Note: Request returned ${statusCode} (Unauthorized/Forbidden). Skipped response schema validation since no schema was defined for this status code.`,
        ],
        timestamp: new Date().toISOString(),
        statusCode,
        requestPayload,
        responseBody,
        responseHeaders,
      };
    }

    if (!matchingSchema) {
      return {
        routeId,
        route: route.path,
        method: route.method,
        passed: false,
        status: 'failed',
        violations: [
          `Response returned status code ${statusCode}, but no matching response schema was defined for it.`,
        ],
        timestamp: new Date().toISOString(),
        statusCode,
        requestPayload,
        responseBody,
        responseHeaders,
      };
    }

    // Validate body against matching schema
    const validation = validateResponse(matchingSchema, responseBody);
    return {
      routeId,
      route: route.path,
      method: route.method,
      passed: validation.passed,
      status: validation.passed ? 'passed' : 'failed',
      violations: validation.violations,
      timestamp: new Date().toISOString(),
      statusCode,
      requestPayload,
      responseBody,
      responseHeaders,
    };
  } catch (err: any) {
    return {
      routeId,
      route: route.path,
      method: route.method,
      passed: false,
      status: 'failed',
      violations: [`Execution error: ${err.message}`],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Runs contract tests for all candidate routes.
 */
export async function runAllContractTests(
  discovery: StudioDiscoveryResult,
  app: any,
): Promise<ContractTestResult[]> {
  const results: ContractTestResult[] = [];

  for (const r of discovery.routes) {
    if (r.isWs) continue;

    const schema = discovery.schemas.find((s) => s.routeId === `${r.method}:${r.path}`);
    if (schema) {
      const res = await runContractTest(app, r, schema);
      results.push(res);
    } else {
      results.push({
        routeId: `${r.method}:${r.path}`,
        route: r.path,
        method: r.method,
        passed: false,
        status: 'missing-schema',
        violations: ['No response schema defined on this route.'],
        timestamp: new Date().toISOString(),
      });
    }
  }

  contractResults = results;
  notifyContractsUpdated();
  return results;
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

export function handleGetContractResults(req: any, res: ServerResponse): void {
  sendJson(res, {
    results: contractResults,
    autoRun,
  });
}

export function handlePostRunContracts(
  req: any,
  res: ServerResponse,
  app: any,
  getDiscovery: () => StudioDiscoveryResult,
): void {
  const discovery = getDiscovery();
  runAllContractTests(discovery, app)
    .then((results) => {
      sendJson(res, { success: true, results });
    })
    .catch((err) => {
      sendJson(res, { error: 'Failed to run contract tests', details: String(err) }, 500);
    });
}

export function handlePostToggleAutoRun(req: any, res: ServerResponse): void {
  const parsedUrl = new URL(req.url ?? '', 'http://localhost');
  const enableParam = parsedUrl.searchParams.get('enable');
  if (enableParam != null) {
    autoRun = enableParam === 'true';
  } else {
    autoRun = !autoRun;
  }
  sendJson(res, { success: true, autoRun });
}
