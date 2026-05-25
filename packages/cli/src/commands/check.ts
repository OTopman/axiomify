/**
 * `axiomify check` — static production-readiness audit.
 *
 * Loads the user's app (no listener boot) and runs a battery of checks
 * against the registered routes, the global `app.hooks` config, and the
 * surrounding environment. Each check has one of three outcomes:
 *
 *   ✓ pass — the configuration is correct
 *   ⚠ warn — non-fatal smell or a likely-but-not-certain issue
 *   ✗ fail — a real correctness / security defect that blocks ship
 *
 * Exit codes:
 *   0 — no fails (warns allowed)
 *   1 — at least one fail
 *
 * This is a SUPPLEMENT to dynamic testing, not a replacement. It catches
 * the class of bugs that are obvious from static inspection — weak
 * defaults, missing global hooks, deprecated metadata shapes — without
 * running against real traffic.
 */
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { pluralise, symbols } from '../utils/format';
import { loadApp } from '../utils/load-app';

type Severity = 'ok' | 'warn' | 'fail';

interface Finding {
  severity: Severity;
  area: string;
  message: string;
  hint?: string;
}

interface CheckCtx {
  app: any;
  cwd: string;
  findings: Finding[];
  pkgJson: Record<string, unknown> | null;
  envKeys: Set<string>;
}

function add(ctx: CheckCtx, f: Finding): void {
  ctx.findings.push(f);
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Has `enableRequestId()` been called? Without it, downstream tracing
 * across microservices loses the request ID chain.
 */
function checkRequestId(ctx: CheckCtx): void {
  const onRequest: unknown[] = ctx.app.hooks?.hooks?.onRequest ?? [];
  if (onRequest.length === 0) {
    add(ctx, {
      severity: 'warn',
      area: 'observability',
      message: '`app.enableRequestId()` has not been called',
      hint: 'Distributed-trace correlation will be impossible without an X-Request-Id header. ' +
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

/**
 * Are required env vars likely to be set in production? We don't try to
 * boot the app — instead we scan the project for references to common
 * env vars and warn if they're missing from `.env.example` or `process.env`.
 */
function checkEnvVars(ctx: CheckCtx): void {
  const expectedInProd = ['JWT_SECRET', 'NODE_ENV'];
  for (const key of expectedInProd) {
    if (!ctx.envKeys.has(key)) continue; // not referenced in code → not relevant
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
              '`node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"`'
            : `Ensure ${key} is set in your deployment environment.`,
      });
    }
  }
}

/**
 * Does every route with a body schema also have a response schema? Missing
 * response schemas leak internal field names and types to clients.
 */
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

/**
 * Catch routes still using the removed `meta:` field (deprecated in 5.x,
 * removed in 6.0) or the removed top-level `openapi:` property (moved into
 * `schema:` in 6.1). Both silently do nothing — surface them loudly here.
 */
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

/**
 * Health-check route registered?
 */
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
    add(ctx, { severity: 'ok', area: 'ops', message: 'health-check route registered' });
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

/**
 * If `@axiomify/openapi` is loaded, did the user register an OpenAPI gate?
 * The plugin warns at runtime in production if unprotected, but catching
 * it pre-flight is cheaper than discovering it during a security review.
 */
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
    // We can't see the `protect` callback statically — just warn that it
    // should be set in production. The plugin itself prints a runtime
    // warning when unprotected; we mirror that here as a checklist item.
    add(ctx, {
      severity: 'warn',
      area: 'security',
      message: 'OpenAPI docs endpoint is registered',
      hint:
        'In production, supply `protect: (req) => ...` to `useOpenAPI()` ' +
        '(or set `allowPublicInProduction: true` if exposure is intentional). ' +
        'The runtime warning is logged on the first request.',
    });
  }
}

/**
 * `_routesLocked` should not be locked yet (the check runs before the
 * adapter would normally lock it). If we find it locked already, the user
 * probably booted the adapter unconditionally in their entry file — which
 * is the same trap `loadApp` warns about, but worth noting here.
 */
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

/**
 * Are common security plugins likely registered? We check by inspecting
 * the hook list — `useHelmet`, `useCors`, `useSecurity` all install onRequest
 * hooks; their presence is a positive signal (we can't tell which one).
 */
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

// ---------------------------------------------------------------------------
// Source-scan helpers
// ---------------------------------------------------------------------------

/**
 * Scan the entry file (and what it transitively requires shallowly — the
 * compiled bundle) for `process.env.XXX` references. We use this as a
 * "what env vars matter to this app" heuristic.
 */
function collectEnvKeysFromBundle(bundlePath: string): Set<string> {
  const keys = new Set<string>();
  try {
    const src = fs.readFileSync(bundlePath, 'utf8');
    // Match `process.env.NAME` and `process.env["NAME"]` / `['NAME']`.
    const re = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[(['"])([A-Z][A-Z0-9_]*)\2\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      keys.add(m[1] ?? m[3]);
    }
  } catch {
    /* swallow — not finding env keys is non-fatal */
  }
  return keys;
}

function loadPkgJson(cwd: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function runCheck(entry: string): Promise<void> {
  let app: any;
  let cleanup = async () => {};
  let bundlePath = '';
  try {
    const loaded = await loadApp(entry);
    app = loaded.app;
    cleanup = loaded.cleanup;
    bundlePath = path.resolve(process.cwd(), '.axiomify/inspect.cjs');
  } catch (err) {
    console.error(pc.red('✗ Failed to load app:'));
    console.error((err as Error).message);
    process.exit(1);
  }

  const ctx: CheckCtx = {
    app,
    cwd: process.cwd(),
    findings: [],
    pkgJson: loadPkgJson(process.cwd()),
    envKeys: collectEnvKeysFromBundle(bundlePath),
  };

  // Run every check. Order is deliberate — env first (most likely to be
  // missing in CI / fresh container), then config, then security, then ops.
  checkEnvVars(ctx);
  checkRequestId(ctx);
  checkRoutesLockState(ctx);
  checkOpenApiNaming(ctx);
  checkSecurityPlugins(ctx);
  checkOpenApiExposure(ctx);
  checkResponseSchemas(ctx);
  checkHealthCheck(ctx);

  await cleanup();

  // ─── Render report ───────────────────────────────────────────────────
  console.log();
  console.log(pc.bold('  🔍 Production-readiness check'));
  console.log();

  const sevOrder: Record<Severity, number> = { fail: 0, warn: 1, ok: 2 };
  ctx.findings.sort(
    (a, b) =>
      sevOrder[a.severity] - sevOrder[b.severity] ||
      a.area.localeCompare(b.area),
  );

  const sym: Record<Severity, string> = {
    ok: symbols.ok,
    warn: symbols.warn,
    fail: symbols.fail,
  };

  for (const f of ctx.findings) {
    const tag = pc.dim(`[${f.area}]`);
    console.log(`  ${sym[f.severity]} ${tag} ${f.message}`);
    if (f.hint && f.severity !== 'ok') {
      // Indent hint with same colour as severity tag, wrap softly at 80.
      const wrapped = f.hint.replace(/(.{1,80})(\s+|$)/g, '\n      ' + pc.dim('$1'));
      console.log(wrapped);
    }
  }

  const fails = ctx.findings.filter((f) => f.severity === 'fail').length;
  const warns = ctx.findings.filter((f) => f.severity === 'warn').length;
  const oks = ctx.findings.filter((f) => f.severity === 'ok').length;

  console.log();
  const summary =
    `  ${symbols.ok} ${pluralise(oks, 'pass', 'passes')}` +
    pc.dim('  ·  ') +
    (warns > 0 ? `${symbols.warn} ${pluralise(warns, 'warning')}` : pc.dim('0 warnings')) +
    pc.dim('  ·  ') +
    (fails > 0 ? `${symbols.fail} ${pluralise(fails, 'failure')}` : pc.dim('0 failures'));
  console.log(summary);
  console.log();

  if (fails > 0) process.exit(1);
}
