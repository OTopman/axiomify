/**
 * Route-surface diffing for `axiomify routes --diff <baseline>`.
 *
 * Categorisation (roadmap §1.3):
 *   - added route                      → info
 *   - removed route                    → BREAKING
 *   - method changed (same path)       → BREAKING
 *   - body/query/params schema change  → BREAKING
 *   - response schema change           → WARNING (--strict-response: BREAKING)
 *   - newly deprecated                 → info
 *
 * A "method changed" is detected by pairing a removed baseline route with an
 * added current route on the exact same path — anything else surfaces as an
 * independent removed + added pair.
 */
import type { RouteSurface, RouteSurfaceEntry, SchemaHashes } from './surface';

export type ChangeKind =
  | 'added'
  | 'removed'
  | 'method-changed'
  | 'schema-changed'
  | 'newly-deprecated';

export type ChangeSeverity = 'info' | 'warning' | 'breaking';

export interface RouteChange {
  kind: ChangeKind;
  severity: ChangeSeverity;
  method: string;
  path: string;
  /** For schema-changed: which schema part changed. */
  part?: keyof SchemaHashes;
  detail: string;
}

export interface DiffOptions {
  /** Treat response-schema changes as breaking instead of warnings. */
  strictResponse?: boolean;
}

export interface DiffResult {
  changes: RouteChange[];
  breaking: number;
  warnings: number;
  info: number;
}

const SCHEMA_PARTS: Array<keyof SchemaHashes> = [
  'body',
  'query',
  'params',
  'response',
];

function key(r: RouteSurfaceEntry): string {
  return `${r.method} ${r.path}`;
}

function diffSchemas(
  before: RouteSurfaceEntry,
  after: RouteSurfaceEntry,
  opts: DiffOptions,
  changes: RouteChange[],
): void {
  // A baseline without schemaHashes (e.g. legacy `routes --json` output)
  // carries no fingerprint information — nothing to compare against.
  if (!before.schemaHashes && !after.schemaHashes) return;
  if (!before.schemaHashes) return;

  for (const part of SCHEMA_PARTS) {
    const prev = before.schemaHashes?.[part];
    const next = after.schemaHashes?.[part];
    if (prev === next) continue;

    const what =
      prev && next
        ? `${part} schema changed`
        : prev
          ? `${part} schema removed`
          : `${part} schema added`;

    const severity: ChangeSeverity =
      part === 'response'
        ? opts.strictResponse
          ? 'breaking'
          : 'warning'
        : 'breaking';

    changes.push({
      kind: 'schema-changed',
      severity,
      method: after.method,
      path: after.path,
      part,
      detail: what,
    });
  }
}

export function diffSurfaces(
  baseline: RouteSurface,
  current: RouteSurface,
  opts: DiffOptions = {},
): DiffResult {
  const changes: RouteChange[] = [];

  const baseByKey = new Map(baseline.routes.map((r) => [key(r), r]));
  const currByKey = new Map(current.routes.map((r) => [key(r), r]));

  const removed = baseline.routes.filter((r) => !currByKey.has(key(r)));
  const added = current.routes.filter((r) => !baseByKey.has(key(r)));

  // Pair removed ↔ added on the same path: that's a method change of one
  // endpoint, not two independent events.
  const consumedAdded = new Set<RouteSurfaceEntry>();
  for (const gone of removed) {
    const replacement = added.find(
      (a) => !consumedAdded.has(a) && a.path === gone.path,
    );
    if (replacement) {
      consumedAdded.add(replacement);
      changes.push({
        kind: 'method-changed',
        severity: 'breaking',
        method: replacement.method,
        path: gone.path,
        detail: `method changed from ${gone.method} to ${replacement.method}`,
      });
    } else {
      changes.push({
        kind: 'removed',
        severity: 'breaking',
        method: gone.method,
        path: gone.path,
        detail: 'route removed',
      });
    }
  }

  for (const fresh of added) {
    if (consumedAdded.has(fresh)) continue;
    changes.push({
      kind: 'added',
      severity: 'info',
      method: fresh.method,
      path: fresh.path,
      detail: 'route added',
    });
  }

  // Routes present in both: compare schema fingerprints + deprecation.
  for (const before of baseline.routes) {
    const after = currByKey.get(key(before));
    if (!after) continue;

    diffSchemas(before, after, opts, changes);

    if (!before.deprecated && after.deprecated) {
      changes.push({
        kind: 'newly-deprecated',
        severity: 'info',
        method: after.method,
        path: after.path,
        detail: 'route is now marked deprecated',
      });
    }
  }

  // Stable presentation order: severity (breaking → warning → info), then
  // path, then method.
  const sevOrder: Record<ChangeSeverity, number> = {
    breaking: 0,
    warning: 1,
    info: 2,
  };
  changes.sort((a, b) => {
    if (sevOrder[a.severity] !== sevOrder[b.severity])
      return sevOrder[a.severity] - sevOrder[b.severity];
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.method.localeCompare(b.method);
  });

  return {
    changes,
    breaking: changes.filter((c) => c.severity === 'breaking').length,
    warnings: changes.filter((c) => c.severity === 'warning').length,
    info: changes.filter((c) => c.severity === 'info').length,
  };
}
