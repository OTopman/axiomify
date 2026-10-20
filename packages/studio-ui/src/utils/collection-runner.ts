import { DiscoveryData, SchemaItem } from '../types';
import { apiFetch } from './api';
import {
  RequestCollection,
  RequestEnvironment,
  RequestKeyValue,
  SavedRequest,
  substituteRequestVariables,
} from './request-collections';
import { executeScriptSandbox } from './script-sandbox';

export interface RunnerAssertionResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface RunnerItemResult {
  requestId: string;
  requestName: string;
  method: string;
  path: string;
  status: number | 'ERROR';
  duration: number;
  passed: boolean;
  assertions: RunnerAssertionResult[];
  responseBody?: any;
  responseHeaders?: Record<string, string>;
  error?: string;
  mutatedEnv?: Record<string, string>;
  scriptLogs?: string[];
}

export interface RunnerReport {
  id: string;
  timestamp: string;
  collectionId: string;
  collectionName: string;
  environmentName: string;
  total: number;
  passed: number;
  failed: number;
  totalDurationMs: number;
  avgDurationMs: number;
  results: RunnerItemResult[];
}

export interface RunnerOptions {
  collection: RequestCollection;
  environment?: RequestEnvironment | null;
  globalEnvVars?: Record<string, string>;
  delayMs?: number;
  stopOnError?: boolean;
  autoExtractTokens?: boolean;
  maxLatencyMs?: number;
  discovery?: DiscoveryData;
  onProgress?: (index: number, total: number, result: RunnerItemResult) => void;
  signal?: AbortSignal;
}

/**
 * Validates response body against route schema discovered by Axiomify
 */
export function validateResponseAgainstSchema(
  responseBody: any,
  schema?: SchemaItem,
): { valid: boolean; errors: string[] } {
  if (!schema?.response) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];
  const respSchema = schema.response;

  if (respSchema.type) {
    if (respSchema.type === 'object') {
      if (
        typeof responseBody !== 'object' ||
        responseBody === null ||
        Array.isArray(responseBody)
      ) {
        errors.push(
          `Expected response of type 'object', but received '${
            Array.isArray(responseBody) ? 'array' : typeof responseBody
          }'`,
        );
      }
    } else if (respSchema.type === 'array') {
      if (!Array.isArray(responseBody)) {
        errors.push(
          `Expected response of type 'array', but received '${typeof responseBody}'`,
        );
      }
    } else if (respSchema.type === 'string') {
      if (typeof responseBody !== 'string') {
        errors.push(
          `Expected response of type 'string', but received '${typeof responseBody}'`,
        );
      }
    } else if (respSchema.type === 'number' || respSchema.type === 'integer') {
      if (typeof responseBody !== 'number') {
        errors.push(
          `Expected response of type 'number', but received '${typeof responseBody}'`,
        );
      }
    } else if (respSchema.type === 'boolean') {
      if (typeof responseBody !== 'boolean') {
        errors.push(
          `Expected response of type 'boolean', but received '${typeof responseBody}'`,
        );
      }
    }
  }

  if (
    respSchema.required &&
    Array.isArray(respSchema.required) &&
    typeof responseBody === 'object' &&
    responseBody !== null
  ) {
    for (const reqProp of respSchema.required) {
      if (!(reqProp in responseBody) || responseBody[reqProp] === undefined) {
        errors.push(`Missing required field '${reqProp}' in response object`);
      }
    }
  }

  if (
    respSchema.properties &&
    typeof responseBody === 'object' &&
    responseBody !== null &&
    !Array.isArray(responseBody)
  ) {
    for (const [propName, propDef] of Object.entries(respSchema.properties)) {
      if (
        propName in responseBody &&
        responseBody[propName] !== undefined &&
        responseBody[propName] !== null
      ) {
        const val = responseBody[propName];
        if (propDef.type === 'string' && typeof val !== 'string') {
          errors.push(
            `Field '${propName}' expected type 'string', received '${typeof val}'`,
          );
        } else if (
          (propDef.type === 'number' || propDef.type === 'integer') &&
          typeof val !== 'number'
        ) {
          errors.push(
            `Field '${propName}' expected type 'number', received '${typeof val}'`,
          );
        } else if (propDef.type === 'boolean' && typeof val !== 'boolean') {
          errors.push(
            `Field '${propName}' expected type 'boolean', received '${typeof val}'`,
          );
        } else if (propDef.type === 'array' && !Array.isArray(val)) {
          errors.push(
            `Field '${propName}' expected type 'array', received '${typeof val}'`,
          );
        } else if (
          propDef.type === 'object' &&
          (typeof val !== 'object' || Array.isArray(val))
        ) {
          errors.push(
            `Field '${propName}' expected type 'object', received '${
              Array.isArray(val) ? 'array' : typeof val
            }'`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Automatically extracts tokens and IDs from response bodies or headers
 * to chain as runtime variables for downstream requests
 */
export function extractRuntimeVariables(
  responseBody: any,
  responseHeaders?: Record<string, string>,
): RequestKeyValue[] {
  const extracted: RequestKeyValue[] = [];
  if (!responseBody || typeof responseBody !== 'object') {
    return extracted;
  }

  const findAndAdd = (obj: Record<string, any>, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      const lower = k.toLowerCase();
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      ) {
        if (
          lower === 'token' ||
          lower === 'access_token' ||
          lower === 'accesstoken' ||
          lower === 'jwt' ||
          lower === 'apikey' ||
          lower === 'api_key' ||
          lower === 'auth_token' ||
          lower === 'authtoken' ||
          lower === 'session_id' ||
          lower === 'sessionid'
        ) {
          extracted.push({ key: 'token', value: String(v) });
          extracted.push({ key: k, value: String(v) });
        } else if (
          lower === 'id' ||
          lower === 'userid' ||
          lower === 'user_id'
        ) {
          extracted.push({ key: k, value: String(v) });
        }
      } else if (typeof v === 'object' && !Array.isArray(v) && prefix === '') {
        findAndAdd(v, k);
      }
    }
  };

  findAndAdd(responseBody);

  if (responseHeaders) {
    if (responseHeaders['authorization']) {
      const auth = responseHeaders['authorization'].replace(/^Bearer\s+/i, '');
      extracted.push({ key: 'token', value: auth });
    }
  }

  return extracted;
}

/**
 * Runs a single request with variable substitution and evaluates assertions
 */
export async function executeSingleRunnerRequest(
  req: SavedRequest,
  activeVariables: RequestKeyValue[],
  discovery?: DiscoveryData,
  maxLatencyMs = 2000,
  signal?: AbortSignal,
): Promise<RunnerItemResult> {
  const resolve = (val: string) =>
    substituteRequestVariables(val, activeVariables);

  // Substitute path
  let finalPath = resolve(req.path).trim() || '/';
  if (req.pathParams && req.pathParams.length > 0) {
    req.pathParams.forEach((p) => {
      const k = resolve(p.key).trim();
      if (k) {
        finalPath = finalPath
          .replace(`:${k}`, resolve(p.value).trim())
          .replace(`{${k}}`, resolve(p.value).trim());
      }
    });
  }

  // Substitute query
  const query: Record<string, string> = {};
  if (req.queryParams && req.queryParams.length > 0) {
    req.queryParams.forEach((q) => {
      const k = resolve(q.key).trim();
      if (k) query[k] = resolve(q.value).trim();
    });
  }

  // Substitute headers
  const headers: Record<string, string> = {};
  if (req.headers && req.headers.length > 0) {
    req.headers.forEach((h) => {
      const k = resolve(h.key).trim();
      if (k) headers[k] = resolve(h.value).trim();
    });
  }

  // Substitute body
  let body: any = undefined;
  if (req.bodyMode === 'json' && req.body?.trim()) {
    try {
      body = JSON.parse(resolve(req.body).trim());
    } catch (err: any) {
      return {
        requestId: req.id,
        requestName: req.name,
        method: req.method,
        path: finalPath,
        status: 'ERROR',
        duration: 0,
        passed: false,
        assertions: [
          {
            name: 'Valid Request JSON Payload',
            passed: false,
            message: `JSON parse error: ${err.message}`,
          },
        ],
        error: `Invalid JSON body: ${err.message}`,
      };
    }
  } else if (req.bodyMode === 'text' && req.body) {
    body = resolve(req.body);
  } else if (
    (req.bodyMode === 'form-data' || req.bodyMode === 'urlencoded') &&
    req.bodyFields
  ) {
    body = req.bodyFields.reduce<Record<string, string>>((acc, f) => {
      const k = resolve(f.key).trim();
      if (k) acc[k] = resolve(f.value);
      return acc;
    }, {});
  }

  // Build active env dictionary
  const activeEnvMap: Record<string, string> = {};
  activeVariables.forEach((v) => {
    if (v.key) activeEnvMap[v.key] = v.value;
  });

  const accumulatedMutatedEnv: Record<string, string> = {};
  const scriptLogs: string[] = [];

  // Execute Pre-request Script if defined
  if (req.preRequestScript && req.preRequestScript.trim()) {
    const preResult = await executeScriptSandbox(req.preRequestScript, {
      request: {
        url: finalPath,
        method: req.method,
        headers,
        body,
        params: query,
      },
      environment: activeEnvMap,
    });

    if (preResult.mutatedRequest) {
      if (preResult.mutatedRequest.headers) {
        Object.assign(headers, preResult.mutatedRequest.headers);
      }
      if (preResult.mutatedRequest.params) {
        Object.assign(query, preResult.mutatedRequest.params);
      }
      if (preResult.mutatedRequest.body !== undefined) {
        body = preResult.mutatedRequest.body;
      }
    }

    if (preResult.mutatedEnv) {
      Object.assign(activeEnvMap, preResult.mutatedEnv);
      Object.assign(accumulatedMutatedEnv, preResult.mutatedEnv);
    }
    if (preResult.logs.length > 0) {
      scriptLogs.push(...preResult.logs);
    }
  }

  const startTime = performance.now();
  let resStatus: number | 'ERROR';
  let resBody: any = undefined;
  let resHeaders: Record<string, string> = {};
  let duration: number;
  let fetchError: string | undefined = undefined;

  try {
    const res = await apiFetch('/__studio/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: req.method,
        path: finalPath,
        headers,
        query,
        body,
        bodyMode: req.bodyMode,
      }),
      signal,
    });

    duration = performance.now() - startTime;
    const result = await res.json();

    if (result.error) {
      resStatus = 'ERROR';
      fetchError = result.error + (result.message ? ': ' + result.message : '');
      resBody = fetchError;
    } else {
      resStatus = result.status;
      resBody = result.body;
      resHeaders = result.headers || {};
      if (result.duration) {
        duration = result.duration;
      }
    }
  } catch (err: any) {
    duration = performance.now() - startTime;
    resStatus = 'ERROR';
    fetchError = err.message || 'Request network failure';
  }

  // Evaluate assertions
  const assertions: RunnerAssertionResult[] = [];

  // 1. Status Code assertion
  const isStatus2xx =
    typeof resStatus === 'number' && resStatus >= 200 && resStatus < 300;
  assertions.push({
    name: `HTTP Status 2xx Success (Received ${resStatus})`,
    passed: isStatus2xx,
    message: isStatus2xx
      ? undefined
      : `Expected 2xx status code but received ${resStatus}`,
  });

  // 2. Latency assertion
  const isWithinLatency = duration <= maxLatencyMs;
  assertions.push({
    name: `Response Time <= ${maxLatencyMs}ms (Took ${duration.toFixed(0)}ms)`,
    passed: isWithinLatency,
    message: isWithinLatency
      ? undefined
      : `Response took ${duration.toFixed(0)}ms exceeding threshold of ${maxLatencyMs}ms`,
  });

  // 3. Schema Compliance Assertion (if discovery schema exists for this route)
  if (discovery?.schemas && typeof resStatus === 'number' && resStatus < 400) {
    const matchingSchema = discovery.schemas.find(
      (s) =>
        s.method.toUpperCase() === req.method.toUpperCase() &&
        s.path === req.path,
    );

    if (matchingSchema?.response) {
      const validation = validateResponseAgainstSchema(resBody, matchingSchema);
      assertions.push({
        name: `Response Conforms to Route Schema`,
        passed: validation.valid,
        message: validation.valid ? undefined : validation.errors.join('; '),
      });
    }
  }

  // 4. Custom Post-response Test Script Assertions ($, axiomify, pm)
  if (req.testScript && req.testScript.trim()) {
    const testResult = await executeScriptSandbox(req.testScript, {
      request: {
        url: finalPath,
        method: req.method,
        headers,
        body,
        params: query,
      },
      response: {
        status: typeof resStatus === 'number' ? resStatus : 0,
        statusText: typeof resStatus === 'number' ? 'OK' : 'ERROR',
        headers: resHeaders,
        responseTime: duration,
        data: resBody,
      },
      environment: activeEnvMap,
    });

    testResult.tests.forEach((t) => {
      assertions.push({
        name: t.name,
        passed: t.passed,
        message: t.error,
      });
    });

    if (testResult.error) {
      assertions.push({
        name: 'Test Script Evaluation',
        passed: false,
        message: testResult.error,
      });
    }

    if (testResult.mutatedEnv) {
      Object.assign(activeEnvMap, testResult.mutatedEnv);
      Object.assign(accumulatedMutatedEnv, testResult.mutatedEnv);
    }
    if (testResult.logs.length > 0) {
      scriptLogs.push(...testResult.logs);
    }
  }

  const allPassed = assertions.every((a) => a.passed);

  return {
    requestId: req.id,
    requestName: req.name,
    method: req.method,
    path: finalPath,
    status: resStatus,
    duration,
    passed: allPassed,
    assertions,
    responseBody: resBody,
    responseHeaders: resHeaders,
    error: fetchError,
    mutatedEnv:
      Object.keys(accumulatedMutatedEnv).length > 0
        ? accumulatedMutatedEnv
        : undefined,
    scriptLogs: scriptLogs.length > 0 ? scriptLogs : undefined,
  };
}

/**
 * Executes a full collection of requests sequentially
 */
export async function runCollectionBatch(
  options: RunnerOptions,
): Promise<RunnerReport> {
  const {
    collection,
    environment,
    globalEnvVars = {},
    delayMs = 0,
    stopOnError = false,
    autoExtractTokens = true,
    maxLatencyMs = 2000,
    discovery,
    onProgress,
    signal,
  } = options;

  // Aggregate starting variables
  const runtimeVarsMap = new Map<string, string>();

  // Add discovery env
  if (discovery?.env) {
    Object.entries(discovery.env).forEach(([k, v]) => {
      if (k && v !== undefined) runtimeVarsMap.set(k, String(v));
    });
  }

  // Add global env vars
  Object.entries(globalEnvVars).forEach(([k, v]) => {
    if (k) runtimeVarsMap.set(k, v);
  });

  // Add active environment variables
  if (environment?.variables) {
    environment.variables.forEach((v) => {
      if (v.key.trim()) runtimeVarsMap.set(v.key.trim(), v.value);
    });
  }

  const results: RunnerItemResult[] = [];
  const startTime = performance.now();
  const total = collection.requests.length;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      break;
    }

    const req = collection.requests[i];

    // Current active variables array
    const currentVars: RequestKeyValue[] = Array.from(
      runtimeVarsMap.entries(),
    ).map(([key, value]) => ({ key, value }));

    const itemResult = await executeSingleRunnerRequest(
      req,
      currentVars,
      discovery,
      maxLatencyMs,
      signal,
    );

    results.push(itemResult);
    if (onProgress) {
      onProgress(i + 1, total, itemResult);
    }

    // Merge script mutations into runtimeVarsMap
    if (itemResult.mutatedEnv) {
      Object.entries(itemResult.mutatedEnv).forEach(([k, v]) => {
        if (v) {
          runtimeVarsMap.set(k, v);
        } else {
          runtimeVarsMap.delete(k);
        }
      });
    }

    // Auto-extract tokens for downstream requests in the chain
    if (autoExtractTokens && itemResult.responseBody) {
      const extracted = extractRuntimeVariables(
        itemResult.responseBody,
        itemResult.responseHeaders,
      );
      extracted.forEach((ev) => {
        runtimeVarsMap.set(ev.key, ev.value);
      });
    }

    // Stop on error if configured
    if (stopOnError && !itemResult.passed) {
      break;
    }

    // Delay between requests
    if (delayMs > 0 && i < total - 1 && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const totalDurationMs = performance.now() - startTime;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const avgDurationMs =
    results.length > 0
      ? results.reduce((acc, r) => acc + r.duration, 0) / results.length
      : 0;

  return {
    id: `run-${Date.now()}`,
    timestamp: new Date().toISOString(),
    collectionId: collection.id,
    collectionName: collection.name,
    environmentName: environment?.name || 'Default Environment',
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    totalDurationMs,
    avgDurationMs,
    results,
  };
}

/**
 * Formats a runner report into GitHub-flavored Markdown
 */
export function generateRunnerMarkdownSummary(report: RunnerReport): string {
  const passRate =
    report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0;
  return `# Collection Test Run: ${report.collectionName}
- **Timestamp**: ${new Date(report.timestamp).toLocaleString()}
- **Environment**: ${report.environmentName}
- **Pass Rate**: ${passRate}% (${report.passed}/${report.total} passed, ${report.failed} failed)
- **Total Duration**: ${report.totalDurationMs.toFixed(1)}ms (avg ${report.avgDurationMs.toFixed(1)}ms per request)

| Method | Endpoint | Request Name | Status | Latency | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
${report.results
  .map(
    (r) =>
      `| \`${r.method}\` | \`${r.path}\` | ${r.requestName} | \`${r.status}\` | ${r.duration.toFixed(
        0,
      )}ms | ${r.passed ? '✅ Passed' : '❌ Failed'} |`,
  )
  .join('\n')}
`;
}
