/**
 * `axiomify routes` — inspect every route registered on the user's Axiomify
 * instance. Prints a Unicode-bordered, terminal-width-aware table with
 * colour-coded HTTP methods, validation badges, OpenAPI tags, and a
 * per-method summary. Supports `--json` for machine consumption and
 * `--method` / `--filter` for narrowing the list.
 *
 * WebSocket routes (`app.ws(...)`) are listed alongside HTTP routes under
 * the `WS` pseudo-method so the report is comprehensive — earlier versions
 * only listed `app.registeredRoutes` and silently omitted WS endpoints.
 */
import pc from 'picocolors';
import {
  Column,
  badge,
  colourMethod,
  pluralise,
  renderTable,
  symbols,
} from '../utils/format';
import { loadApp } from '../utils/load-app';

export interface RoutesOptions {
  json?: boolean;
  method?: string;
  filter?: string;
  sort?: 'method' | 'path';
}

interface NormalisedRoute {
  method: string;
  path: string;
  validation: string[];
  tags: string[];
  operationId?: string;
  deprecated: boolean;
  timeout?: number;
  plugins: number;
  isWs: boolean;
}

function normalise(raw: any, isWs: boolean): NormalisedRoute {
  const validation: string[] = [];
  if (raw.schema?.body) validation.push('Body');
  if (raw.schema?.query) validation.push('Query');
  if (raw.schema?.params) validation.push('Params');
  if (raw.schema?.response) validation.push('Response');
  if (raw.schema?.files) validation.push('Files');
  if (raw.schema?.message) validation.push('Message');

  const op = raw.openapi ?? {};

  return {
    method: isWs ? 'WS' : raw.method,
    path: raw.path,
    validation,
    tags: Array.isArray(op.tags) ? op.tags : [],
    operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
    deprecated: op.deprecated === true,
    timeout: typeof raw.timeout === 'number' && raw.timeout > 0 ? raw.timeout : undefined,
    plugins: Array.isArray(raw.plugins) ? raw.plugins.length : 0,
    isWs,
  };
}

function matchesFilter(route: NormalisedRoute, opts: RoutesOptions): boolean {
  if (opts.method) {
    const wanted = opts.method
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);
    if (wanted.length && !wanted.includes(route.method)) return false;
  }
  if (opts.filter) {
    // Glob-lite: '*' matches any chars, otherwise substring match.
    const pat = opts.filter;
    if (pat.includes('*')) {
      const re = new RegExp(
        '^' +
          pat
            .split('*')
            .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$',
      );
      if (!re.test(route.path)) return false;
    } else if (!route.path.includes(pat)) {
      return false;
    }
  }
  return true;
}

function sortRoutes(routes: NormalisedRoute[], by: 'method' | 'path'): NormalisedRoute[] {
  const methodOrder: Record<string, number> = {
    GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, HEAD: 5, OPTIONS: 6, WS: 7,
  };
  return [...routes].sort((a, b) => {
    if (by === 'method') {
      const am = methodOrder[a.method] ?? 99;
      const bm = methodOrder[b.method] ?? 99;
      if (am !== bm) return am - bm;
      return a.path.localeCompare(b.path);
    }
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return (methodOrder[a.method] ?? 99) - (methodOrder[b.method] ?? 99);
  });
}

export async function inspectRoutes(
  entry: string,
  opts: RoutesOptions = {},
): Promise<void> {
  let app: any;
  let cleanup = async () => {};
  try {
    const loaded = await loadApp(entry);
    app = loaded.app;
    cleanup = loaded.cleanup;
  } catch (err) {
    console.error(pc.red('✗ Failed to load app:'));
    console.error((err as Error).message);
    process.exit(1);
  }

  try {
    const httpRoutes: NormalisedRoute[] = (app.registeredRoutes ?? []).map(
      (r: any) => normalise(r, false),
    );
    const wsRoutes: NormalisedRoute[] = (app.registeredWsRoutes ?? []).map(
      (r: any) => normalise(r, true),
    );
    const all = sortRoutes([...httpRoutes, ...wsRoutes], opts.sort ?? 'path');
    const filtered = all.filter((r) => matchesFilter(r, opts));

    // ─── JSON output ───────────────────────────────────────────────────
    if (opts.json) {
      process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
      return;
    }

    // ─── Empty result ──────────────────────────────────────────────────
    if (filtered.length === 0) {
      console.log(
        '\n' +
          symbols.info +
          pc.dim(
            `  No routes match the current filter (` +
              `${all.length} total registered).\n`,
          ),
      );
      return;
    }

    // ─── Header ────────────────────────────────────────────────────────
    console.log();
    console.log(pc.bold('  🧭 Axiomify routes'));
    console.log();

    // ─── Table ─────────────────────────────────────────────────────────
    const columns: Column[] = [
      { header: 'METHOD', minWidth: 7 },
      { header: 'PATH', minWidth: 20, maxWidth: 60 },
      { header: 'VALIDATION', minWidth: 10, maxWidth: 32 },
      { header: 'META', maxWidth: 40 },
    ];

    const rows = filtered.map((r) => {
      const method = colourMethod(r.method);

      const path = r.deprecated
        ? pc.strikethrough(r.path) + ' ' + badge.deprecated()
        : r.path;

      const validation =
        r.validation.length > 0
          ? r.validation.map(badge.validation).join(pc.dim(','))
          : pc.dim('—');

      const metaBits: string[] = [];
      if (r.operationId) metaBits.push(pc.dim(`op:`) + r.operationId);
      if (r.tags.length) metaBits.push(badge.tags(r.tags));
      if (r.timeout !== undefined) metaBits.push(badge.timeout(r.timeout));
      if (r.plugins > 0) metaBits.push(pc.dim(`+${r.plugins} plugin${r.plugins === 1 ? '' : 's'}`));
      const meta = metaBits.length ? metaBits.join(' ') : pc.dim('—');

      return [method, path, validation, meta];
    });

    console.log(renderTable(columns, rows));

    // ─── Summary ───────────────────────────────────────────────────────
    const byMethod = filtered.reduce<Record<string, number>>((acc, r) => {
      acc[r.method] = (acc[r.method] ?? 0) + 1;
      return acc;
    }, {});
    const summaryParts = Object.entries(byMethod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, n]) => `${colourMethod(m).trimEnd()} ${pc.bold(String(n))}`);

    console.log();
    console.log(
      `  ${symbols.ok} ${pluralise(filtered.length, 'route')}` +
        (filtered.length < all.length
          ? pc.dim(` (filtered from ${all.length})`)
          : '') +
        '   ' +
        summaryParts.join(pc.dim(' · ')),
    );
    // Only mention WS routes when the current view actually contains some
    // (a `--method GET` filter or a `--filter` that excludes /chat would
    // make the previous "WebSocket routes included" line misleading).
    const filteredWs = filtered.filter((r) => r.isWs).length;
    if (filteredWs > 0) {
      console.log(
        pc.dim(`    └ ${pluralise(filteredWs, 'WebSocket route')} included`),
      );
    }
    console.log();
  } catch (error) {
    console.error(pc.red('✗ Failed to inspect routes:'), error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}
