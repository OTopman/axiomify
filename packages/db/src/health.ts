import type { DatabaseHandle } from './module';

/**
 * Build the `checks` record for `app.healthCheck(path, checks)` from one or
 * more database handles. Each check runs the handle's configured probe with
 * the built-in 3s timeout and resolves to a boolean — it never throws.
 *
 * ```ts
 * app.healthCheck('/health', dbHealthChecks(primary, analytics));
 * // → { primary: () => Promise<boolean>, analytics: () => Promise<boolean> }
 * ```
 *
 * Keys are the handles' `name` options, so they must be unique — duplicate
 * names throw immediately rather than silently shadowing a check.
 */
export function dbHealthChecks(
  ...handles: DatabaseHandle[]
): Record<string, () => Promise<boolean>> {
  if (handles.length === 0) {
    throw new Error(
      '[@axiomify/db] dbHealthChecks requires at least one database handle.',
    );
  }
  const checks: Record<string, () => Promise<boolean>> = {};
  for (const handle of handles) {
    if (Object.prototype.hasOwnProperty.call(checks, handle.name)) {
      throw new Error(
        `[@axiomify/db] Duplicate database name "${handle.name}" passed to ` +
          'dbHealthChecks. Give each database a unique `name` option.',
      );
    }
    checks[handle.name] = () => handle.healthCheck();
  }
  return checks;
}

/**
 * Build an `onShutdown` callback for `gracefulShutdown(server, { onShutdown })`
 * that disconnects every given database. All disconnects run in parallel; if
 * any fail, the failures are collected into a single `AggregateError` so the
 * remaining databases still close cleanly.
 *
 * ```ts
 * gracefulShutdown(server, { onShutdown: dbShutdown(primary, analytics) });
 * ```
 *
 * Prefer the `registerShutdown` option of `createDatabaseModule` if you want
 * each database to self-wire into your own shutdown registry instead.
 */
export function dbShutdown(
  ...handles: DatabaseHandle[]
): () => Promise<void> {
  if (handles.length === 0) {
    throw new Error(
      '[@axiomify/db] dbShutdown requires at least one database handle.',
    );
  }
  return async () => {
    const results = await Promise.allSettled(
      handles.map((handle) => handle.disconnect()),
    );
    const failures: { name: string; reason: unknown }[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        failures.push({ name: handles[i].name, reason: result.reason });
      }
    });
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map(({ reason }) =>
          reason instanceof Error ? reason : new Error(String(reason)),
        ),
        `[@axiomify/db] Failed to disconnect ${failures.length} database(s): ` +
          failures.map(({ name }) => `"${name}"`).join(', '),
      );
    }
  };
}
