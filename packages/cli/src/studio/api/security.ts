import type { ServerResponse } from 'node:http';
import type { StudioDiscoveryResult } from '../discovery/types';
import { sendJson } from '../server/http-server';

export interface SecurityFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'auth' | 'cors' | 'headers' | 'graphql' | 'validation' | 'deprecation' | 'injection';
  route?: string;
  method?: string;
  title: string;
  description: string;
  remediation: string;
  cwe?: string;
}

let staticFindings: SecurityFinding[] = [];
let dynamicFindings: SecurityFinding[] = [];
let isProbing = false;
let probeProgress = 0;

/**
 * Run static checks against discovery results and app instance.
 */
export async function runStaticAnalysis(
  discovery: StudioDiscoveryResult,
  app: any
): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];

  // 1. Missing Auth check
  for (const r of discovery.routes) {
    if (r.isWs) continue;

    const isPublicPath =
      r.path === '/' ||
      r.path === '/metrics' ||
      r.path === '/live-feed' ||
      r.path.startsWith('/docs') ||
      r.path.startsWith('/assets') ||
      r.path === '/api/login';

    const hasAuthPlugin =
      r.plugins &&
      r.plugins.some((p) => p.toLowerCase().includes('auth') || p.toLowerCase().includes('jwt'));

    if (!hasAuthPlugin && !isPublicPath) {
      const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(r.method);
      findings.push({
        id: `sec-auth-${r.method}-${r.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        severity: isMutating ? 'high' : 'medium',
        category: 'auth',
        route: r.path,
        method: r.method,
        title: `Route Lacks Authentication`,
        description: `The endpoint "${r.method} ${r.path}" does not use any authentication middleware and is publicly accessible.`,
        remediation: `Attach an authentication plugin (e.g. createAuthPlugin) to secure this route.`,
        cwe: 'CWE-306',
      });
    }
  }

  // 2. Schema-less routes check
  for (const r of discovery.routes) {
    if (r.isWs) continue;

    const isPublicPath =
      r.path === '/metrics' ||
      r.path === '/live-feed' ||
      r.path.startsWith('/docs') ||
      r.path.startsWith('/assets');

    if (isPublicPath) continue;

    // Body schema checking for data carrying methods
    const needsValidation = ['POST', 'PUT', 'PATCH'].includes(r.method);
    const hasSchema = r.validation && r.validation.length > 0;

    if (needsValidation && !hasSchema) {
      findings.push({
        id: `sec-schema-${r.method}-${r.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        severity: 'medium',
        category: 'validation',
        route: r.path,
        method: r.method,
        title: `Schema-less Route Input Validation`,
        description: `The data-carrying route "${r.method} ${r.path}" has no input validation schema defined. Incoming payloads are unvalidated.`,
        remediation: `Define a Zod validation schema (e.g. body: z.object({...})) inside the route definition.`,
        cwe: 'CWE-20',
      });
    }
  }

  // 3. Deprecated routes check
  for (const r of discovery.routes) {
    if (r.deprecated) {
      findings.push({
        id: `sec-depr-${r.method}-${r.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        severity: 'low',
        category: 'deprecation',
        route: r.path,
        method: r.method,
        title: `Active Deprecated Route`,
        description: `The route "${r.method} ${r.path}" is active but marked as deprecated.`,
        remediation: `Ensure clients migrate away from this route and decommission it when safe.`,
        cwe: 'CWE-1035',
      });
    }
  }

  // 4. In-memory dynamic static checks (CORS, CSP, GraphQL)
  try {
    // Send a mock request to root or metrics to read headers
    const mockRes = await mockRequest(app, 'GET', '/metrics', {
      origin: 'https://evil.com',
    });

    if (mockRes) {
      // CORS check
      const allowOrigin = mockRes.headers['access-control-allow-origin'];
      const allowCreds = mockRes.headers['access-control-allow-credentials'];

      if (allowOrigin === '*' || allowOrigin === 'https://evil.com') {
        if (allowCreds === 'true') {
          findings.push({
            id: 'sec-cors-wildcard-creds',
            severity: 'high',
            category: 'cors',
            title: 'CORS Wildcard with Credentials Allowed',
            description: 'The CORS policy allows credential sharing (Access-Control-Allow-Credentials: true) with a wildcard or arbitrary origin.',
            remediation: 'Do not allow arbitrary origins when credentials are enabled. Configure CORS origin to a specific trusted domain.',
            cwe: 'CWE-942',
          });
        }
      }

      // CSP check
      const csp = mockRes.headers['content-security-policy'] || mockRes.headers['content-security-policy-report-only'];
      if (!csp) {
        findings.push({
          id: 'sec-csp-missing',
          severity: 'medium',
          category: 'headers',
          title: 'Missing Content-Security-Policy Header',
          description: 'The application does not send a Content-Security-Policy header, leaving it vulnerable to XSS and clickjacking.',
          remediation: 'Enable useHelmet() or configure explicit Content-Security-Policy headers.',
          cwe: 'CWE-1021',
        });
      }
    }
  } catch {}

  // 5. GraphQL Introspection check
  const hasGraphql = discovery.routes.some((r) => r.path === '/graphql');
  if (hasGraphql) {
    try {
      const mockRes = await mockRequest(app, 'POST', '/graphql', {}, {
        query: 'query { __schema { queryType { name } } }',
      });
      if (mockRes && mockRes.body) {
        const parsed = JSON.parse(mockRes.body);
        if (parsed?.data?.__schema) {
          findings.push({
            id: 'sec-graphql-introspection',
            severity: 'low',
            category: 'graphql',
            route: '/graphql',
            method: 'POST',
            title: 'GraphQL Introspection Enabled',
            description: 'GraphQL introspection is enabled, allowing clients to query and discover the full schema structure.',
            remediation: 'Disable introspection in production environments by passing `introspection: false` to the GraphQL middleware.',
            cwe: 'CWE-200',
          });
        }
      }
    } catch {}
  }

  staticFindings = findings;
  return findings;
}

/**
 * Runs dynamic injection probes against routes.
 */
export async function runDynamicProbes(
  discovery: StudioDiscoveryResult,
  app: any
): Promise<SecurityFinding[]> {
  isProbing = true;
  probeProgress = 0;
  dynamicFindings = [];

  const stringProbes = [
    {
      name: 'SQL Injection',
      payload: "' OR '1'='1",
      category: 'injection' as const,
      cwe: 'CWE-89',
      title: 'Potential SQL Injection Vulnerability',
    },
    {
      name: 'Cross-Site Scripting (XSS)',
      payload: '<script>alert(1)</script>',
      category: 'injection' as const,
      cwe: 'CWE-79',
      title: 'Potential Cross-Site Scripting (XSS)',
    },
    {
      name: 'Path Traversal',
      payload: '../../../../etc/passwd',
      category: 'injection' as const,
      cwe: 'CWE-22',
      title: 'Potential Path Traversal Vulnerability',
    },
  ];

  // Pick up to 5 routes with schemas to test
  const candidateRoutes = discovery.routes.filter(
    (r) => !r.isWs && r.validation && r.validation.length > 0 && ['POST', 'PUT', 'PATCH'].includes(r.method)
  ).slice(0, 5);

  let completed = 0;
  const total = candidateRoutes.length * stringProbes.length;

  for (const r of candidateRoutes) {
    const routeSchemas = discovery.schemas.find(
      (s) => (s.routeId || `${s.method.toUpperCase()}:${s.path}`) === `${r.method.toUpperCase()}:${r.path}`
    );

    if (!routeSchemas || !routeSchemas.body) {
      completed += stringProbes.length;
      continue;
    }

    // Identify string fields in the body schema
    const bodyProps = routeSchemas.body.properties || {};
    const stringKeys = Object.entries(bodyProps)
      .filter(([_, value]: any) => value.type === 'string')
      .map(([key]) => key);

    if (stringKeys.length === 0) {
      completed += stringProbes.length;
      continue;
    }

    for (const probe of stringProbes) {
      // Create payload putting the malicious string in all string parameters
      const testBody: Record<string, string> = {};
      for (const k of stringKeys) {
        testBody[k] = probe.payload;
      }

      try {
        const res = await mockRequest(app, r.method, r.path, {}, testBody);
        
        // If the route returns 200 OK or 500 without a proper validation error (400 Bad Request),
        // it means the input was either processed blindly or caused a database/internal crash.
        if (res && (res.status === 200 || res.status === 500)) {
          // Flag as potential vulnerability
          dynamicFindings.push({
            id: `sec-dyn-${r.method}-${r.path.replace(/[^a-zA-Z0-9]/g, '-')}-${probe.name.toLowerCase().replace(/ /g, '-')}`,
            severity: 'critical',
            category: 'injection',
            route: r.path,
            method: r.method,
            title: probe.title,
            description: `The route "${r.method} ${r.path}" processed a malicious ${probe.name} payload without schema rejection (Status ${res.status}). Payload used: "${probe.payload}"`,
            remediation: `Implement strict validation constraints (e.g. z.string().uuid(), z.string().email(), or regex patterns) to prevent injection strings.`,
            cwe: probe.cwe,
          });
        }
      } catch (err) {
        // Safe if it threw a validation error
      }

      completed++;
      probeProgress = Math.round((completed / total) * 100);
    }
  }

  isProbing = false;
  probeProgress = 100;
  return dynamicFindings;
}

/**
 * Send a mock in-memory request to the app.
 */
async function mockRequest(
  app: any,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; headers: Record<string, string>; body?: string } | null> {
  return new Promise((resolve) => {
    let responseStatus = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody = '';

    const timeout = setTimeout(() => {
      resolve({
        status: 500,
        headers: {},
        body: 'Timeout during mock request',
      });
    }, 2000);

    const resolveWithCleanup = (val: any) => {
      clearTimeout(timeout);
      resolve(val);
    };

    const req: any = {
      id: `studio-security-${Date.now()}`,
      method: method.toUpperCase(),
      url: path,
      path,
      headers: {
        host: 'localhost',
        'content-type': 'application/json',
        ...headers,
      },
      state: {},
      signal: { addEventListener: () => {} },
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
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return this;
      },
      writeHead(code: number, headers?: any) {
        responseStatus = code;
        if (headers) {
          Object.entries(headers).forEach(([k, v]) => {
            responseHeaders[k.toLowerCase()] = String(v);
          });
        }
        return this;
      },
      send(data: any) {
        responseBody = typeof data === 'object' ? JSON.stringify(data) : String(data);
        resolveWithCleanup({
          status: responseStatus,
          headers: responseHeaders,
          body: responseBody,
        });
      },
      end(data?: any) {
        if (data) {
          responseBody = typeof data === 'object' ? JSON.stringify(data) : String(data);
        }
        resolveWithCleanup({
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
      app.handle(req, res).catch((err: any) => {
        resolveWithCleanup({
          status: 500,
          headers: {},
          body: err.message || 'Error during mock handle',
        });
      });
    } catch (err: any) {
      resolveWithCleanup({
        status: 500,
        headers: {},
        body: err.message || 'Sync error during mock handle',
      });
    }
  });
}

export function handleGetSecurityReport(req: any, res: ServerResponse, app: any, getDiscovery: () => StudioDiscoveryResult): void {
  const discovery = getDiscovery();
  
  // We run static checks dynamically on fetch to ensure it reflects current state
  runStaticAnalysis(discovery, app).then((staticList) => {
    sendJson(res, {
      static: staticList,
      dynamic: dynamicFindings,
      isProbing,
      progress: probeProgress,
    });
  }).catch(() => {
    sendJson(res, { error: 'Failed to run security analysis' }, 500);
  });
}

export function handlePostRunProbes(req: any, res: ServerResponse, app: any, getDiscovery: () => StudioDiscoveryResult): void {
  if (isProbing) {
    sendJson(res, { error: 'Probing is already in progress' }, 400);
    return;
  }

  const discovery = getDiscovery();

  // Run async
  runDynamicProbes(discovery, app).catch(() => {});

  sendJson(res, { success: true });
}

export function getSecurityFindings(): SecurityFinding[] {
  return [...staticFindings, ...dynamicFindings];
}
