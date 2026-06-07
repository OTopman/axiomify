import fs from 'node:fs';
import path from 'node:path';
import type { DiscoveredHealth, DiscoveredHealthFinding } from './types';

interface CheckCtx {
  app: any;
  findings: DiscoveredHealthFinding[];
  envKeys: Set<string>;
}

function add(ctx: CheckCtx, f: DiscoveredHealthFinding): void {
  ctx.findings.push(f);
}

function checkRequestId(ctx: CheckCtx): void {
  const onRequest: unknown[] = ctx.app.hooks?.hooks?.onRequest ?? [];
  if (onRequest.length === 0) {
    add(ctx, {
      severity: 'warn',
      area: 'observability',
      message: '`app.enableRequestId()` has not been called',
      hint:
        'Distributed-trace correlation will be impossible without an X-Request-Id header. ' +
        'Add `app.enableRequestId()` after construction unless you handle this elsewhere.',
    });
    return;
  }
  add(ctx, {
    severity: 'ok',
    area: 'observability',
    message: `onRequest hooks: ${onRequest.length} registered`,
  });
}

function checkEnvVars(ctx: CheckCtx): void {
  const expectedInProd = ['JWT_SECRET', 'NODE_ENV'];
  for (const key of expectedInProd) {
    if (!ctx.envKeys.has(key)) continue;
    if (process.env[key]) {
      add(ctx, { severity: 'ok', area: 'env', message: `${key} is set` });
    } else {
      add(ctx, {
        severity: 'warn',
        area: 'env',
        message: `${key} referenced in source but not set in environment`,
        hint:
          key === 'JWT_SECRET'
            ? 'Set this before deploying. Generate one via ' +
              "`node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\"`"
            : `Ensure ${key} is set in your deployment environment.`,
      });
    }
  }
}

function checkResponseSchemas(ctx: CheckCtx): void {
  const routes = ctx.app.registeredRoutes ?? [];
  const missing = routes.filter(
    (r: any) => r.schema?.body && !r.schema?.response,
  );
  if (missing.length > 0) {
    add(ctx, {
      severity: 'warn',
      area: 'validation',
      message: `${missing.length} route${missing.length === 1 ? '' : 's'} with body schema but no response schema`,
      hint:
        'Declaring `schema.response` pins the API contract — without it, internal model ' +
        'field names leak to clients and breaking changes go undetected. ' +
        `First offender: ${missing[0].method} ${missing[0].path}`,
    });
  } else if (routes.length > 0) {
    add(ctx, {
      severity: 'ok',
      area: 'validation',
      message: 'every route with a body schema also declares a response schema',
    });
  }
}

function checkOpenApiNaming(ctx: CheckCtx): void {
  const routes = ctx.app.registeredRoutes ?? [];

  const usingMeta = routes.filter((r: any) => r.meta);
  if (usingMeta.length > 0) {
    add(ctx, {
      severity: 'fail',
      area: 'api',
      message: `${usingMeta.length} route${usingMeta.length === 1 ? '' : 's'} use the removed \`meta:\` field`,
      hint:
        'The `meta:` field was removed in 6.0. Move all metadata into `schema:` — ' +
        `e.g. schema: { tags: ['Users'], summary: '...' }. First offender: ${usingMeta[0].method} ${usingMeta[0].path}`,
    });
  }

  const usingOpenapi = routes.filter((r: any) => r.openapi);
  if (usingOpenapi.length > 0) {
    add(ctx, {
      severity: 'fail',
      area: 'api',
      message: `${usingOpenapi.length} route${usingOpenapi.length === 1 ? '' : 's'} use the removed top-level \`openapi:\` field`,
      hint:
        'The separate `openapi:` property was removed in 6.1. Move all metadata ' +
        'directly into `schema:` alongside your Zod fields. Run `npx axiomify migrate` ' +
        `to apply automatically. First offender: ${usingOpenapi[0].method} ${usingOpenapi[0].path}`,
    });
  }
}

function checkHealthCheck(ctx: CheckCtx): void {
  const routes = ctx.app.registeredRoutes ?? [];
  const hasHealth = routes.some(
    (r: any) =>
      r.method === 'GET' &&
      ['/health', '/healthz', '/-/health', '/ping', '/live', '/ready'].some(
        (p) => r.path === p,
      ),
  );
  if (hasHealth) {
    add(ctx, {
      severity: 'ok',
      area: 'ops',
      message: 'health-check route registered',
    });
  } else {
    add(ctx, {
      severity: 'warn',
      area: 'ops',
      message: 'no health-check route detected',
      hint:
        'Kubernetes, ECS, and load balancers expect a `/health` (or similar) endpoint. ' +
        'Register one via `app.healthCheck("/health")` from `@axiomify/core`.',
    });
  }
}

function checkOpenApiExposure(ctx: CheckCtx): void {
  const routes = ctx.app.registeredRoutes ?? [];
  const docsRoute = routes.find(
    (r: any) =>
      r.method === 'GET' && (r.path === '/docs' || r.path.endsWith('/docs')),
  );
  const specRoute = routes.find(
    (r: any) => r.method === 'GET' && r.path.endsWith('/openapi.json'),
  );
  if (docsRoute || specRoute) {
    add(ctx, {
      severity: 'warn',
      area: 'security',
      message: 'OpenAPI docs endpoint is registered',
      hint:
        'In production, supply `protect: (req) => ...` to `useOpenAPI()` ' +
        '(or set `allowPublicInProduction: true` if exposure is intentional).',
    });
  }
}

function checkRoutesLockState(ctx: CheckCtx): void {
  if ((ctx.app as any)._routesLocked) {
    add(ctx, {
      severity: 'warn',
      area: 'config',
      message: 'app.lockRoutes() has already been called',
      hint:
        'The entry file appears to construct an adapter at the top level. ' +
        'Wrap adapter construction in `if (require.main === module) { ... }` so the CLI ' +
        'can introspect the app without triggering it.',
    });
  }
}

function checkSecurityPlugins(ctx: CheckCtx): void {
  const onRequest: unknown[] = ctx.app.hooks?.hooks?.onRequest ?? [];
  if (onRequest.length < 2) {
    add(ctx, {
      severity: 'warn',
      area: 'security',
      message:
        'few onRequest hooks detected — security plugins may not be registered',
      hint:
        '`@axiomify/helmet`, `@axiomify/cors`, and `@axiomify/security` each install onRequest ' +
        'hooks. If you are not using these, ensure equivalent defences are in place elsewhere.',
    });
  } else {
    add(ctx, {
      severity: 'ok',
      area: 'security',
      message: `${onRequest.length} onRequest hooks registered (security plugins likely active)`,
    });
  }
}

function collectEnvKeysFromBundle(bundlePath: string): Set<string> {
  const keys = new Set<string>();
  try {
    const src = fs.readFileSync(bundlePath, 'utf8');
    const re =
      /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[(['"])([A-Z][A-Z0-9_]*)\2\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      keys.add(m[1] ?? m[3]);
    }
  } catch {
    // Non-fatal
  }
  return keys;
}

export function discoverHealth(app: any): DiscoveredHealth {
  const bundlePath = path.resolve(process.cwd(), '.axiomify/inspect.cjs');
  const envKeys = collectEnvKeysFromBundle(bundlePath);

  const ctx: CheckCtx = {
    app,
    findings: [],
    envKeys,
  };

  checkEnvVars(ctx);
  checkRequestId(ctx);
  checkRoutesLockState(ctx);
  checkOpenApiNaming(ctx);
  checkSecurityPlugins(ctx);
  checkOpenApiExposure(ctx);
  checkResponseSchemas(ctx);
  checkHealthCheck(ctx);

  const passes = ctx.findings.filter((f) => f.severity === 'ok').length;
  const warnings = ctx.findings.filter((f) => f.severity === 'warn').length;
  const failures = ctx.findings.filter((f) => f.severity === 'fail').length;

  return {
    findings: ctx.findings,
    summary: {
      passes,
      warnings,
      failures,
    },
  };
}
