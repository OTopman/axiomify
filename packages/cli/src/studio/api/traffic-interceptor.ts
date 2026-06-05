/**
 * Studio Traffic Interceptor
 *
 * Instruments the Axiomify app's request lifecycle hooks to measure
 * real production traffic latencies (not just Studio proxy requests).
 *
 * Always-on in Studio mode: attaches `onRequest` and `onPostHandler`
 * hooks with `performance.now()` timing. Adds ~0.05ms overhead per hop.
 * Wraps the compiled pipeline with per-step timing shims.
 */
import { compiledStates } from '@axiomify/core';
import { recordLatency, recordServiceLatency } from './perf';
import { logCorrelationStorage } from './logs';

/**
 * Instruments the given Axiomify app to track real production
 * request latencies for all routes, middleware, hooks, and DB services.
 *
 * Safe to call multiple times (re-entrant): re-calling on a new app
 * instance (after live-sync reload) creates fresh hooks without leaking
 * the old app reference.
 */
export function instrumentTrafficProfiling(app: any): void {
  if (!app) return;

  try {
    // ── Per-request timing via onRequest / onPostHandler ─────────────
    // We stash the start time on the request object so the post-handler
    // can compute the total wall-clock duration without any shared state.
    app.addHook('onRequest', (req: any) => {
      if (!req) return;
      // Skip Studio's own internal requests
      const path = req.path || (req.url ? new URL(req.url, 'http://x').pathname : '/');
      if (path.startsWith('/__studio/')) return;
      req.id = req.id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      req.__perfStart = performance.now();
    });

    app.addHook('onPostHandler', (req: any, _res: any) => {
      if (!req || req.__perfStart == null) return;
      const path = req.path || (req.url ? new URL(req.url, 'http://x').pathname : '/');
      if (path.startsWith('/__studio/')) return;

      const totalDuration = performance.now() - req.__perfStart;
      const method = (req.method || 'GET').toUpperCase();
      const timeline: { name: string; type: string; duration: number }[] = req.__perfTimeline || [];
      const queries: { query: string; durationMs: number }[] = req.__perfQueries || [];

      recordLatency(path, method, totalDuration, timeline, queries);
    });

    // ── Compiled pipeline step timing ─────────────────────────────────
    // Wrap each route's compiled pipeline steps once at startup to measure
    // individual middleware/handler durations without per-request overhead.
    // We use a lazy-wrap approach: wrap on first access of each route's state.
    _wrapCompiledPipelines(app);

    // ── DI service method timing ──────────────────────────────────────
    _wrapServiceMethods(app);
  } catch {
    // Never crash the app due to instrumentation failures
  }
}

/**
 * Wraps the compiled pipeline of every registered route with timing shims.
 * Uses `compiledStates` from @axiomify/core — the same map the request
 * dispatcher uses. We replace each fn with a thin wrapper that records
 * its duration on `req.__perfTimeline`.
 */
function _wrapCompiledPipelines(app: any): void {
  try {
    if (!app.registeredRoutes || !compiledStates) return;

    for (const route of app.registeredRoutes) {
      const state = compiledStates.get(route);
      if (!state || !Array.isArray(state.pipeline)) continue;

      // Guard: don't double-wrap
      if ((state as any).__perfWrapped) continue;

      const wrappedPipeline = state.pipeline.map((fn: any, index: number) => {
        const stepName = fn.name || `step-${index}`;
        const isHandler = index === state.pipeline.length - 1;
        const typeStr = isHandler ? 'handler' : 'middleware';
        const label = isHandler ? `Handler: ${stepName}` : `Middleware: ${stepName}`;

        return async function perfWrappedStep(req: any, res: any) {
          const runStep = async () => {
            if (!req || req.__perfStart == null) {
              return fn(req, res);
            }
            const start = performance.now();
            try {
              const ret = fn(req, res);
              if (ret instanceof Promise) await ret;
            } finally {
              const duration = performance.now() - start;
              if (!req.__perfTimeline) req.__perfTimeline = [];
              req.__perfTimeline.push({ name: label, type: typeStr, duration });
            }
          };

          if (req && req.id) {
            return logCorrelationStorage.run(req.id, runStep);
          } else {
            return runStep();
          }
        };
      });

      compiledStates.set(route, { ...state, pipeline: wrappedPipeline, __perfWrapped: true } as any);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Wraps DI service methods for services named after known patterns
 * (db, database, prisma, repo, service) to measure per-method latency.
 */
function _wrapServiceMethods(app: any): void {
  try {
    if (!(app._services instanceof Map)) return;

    for (const [token, service] of app._services.entries()) {
      if (!service || typeof service !== 'object') continue;
      const tokenStr = String(token).toLowerCase();
      const ctorName = (service.constructor?.name || '').toLowerCase();

      // Only wrap services with meaningful names (avoid wrapping primitives/configs)
      const isNamedService =
        tokenStr.length > 2 &&
        !['config', 'options', 'env'].some(w => tokenStr.includes(w));
      if (!isNamedService) continue;

      const proto = Object.getPrototypeOf(service);
      const methods = proto && proto !== Object.prototype
        ? Object.getOwnPropertyNames(proto).filter(k => k !== 'constructor' && typeof service[k] === 'function')
        : Object.keys(service).filter(k => typeof service[k] === 'function');

      for (const method of methods) {
        const original = service[method];
        if (typeof original !== 'function' || (original as any).__perfWrapped) continue;

        service[method] = function(...args: any[]) {
          const start = performance.now();
          let ret: any;
          try {
            ret = original.apply(this, args);
          } catch (err) {
            recordServiceLatency(tokenStr, method, performance.now() - start);
            throw err;
          }
          if (ret instanceof Promise) {
            return ret.then(
              (v: any) => { recordServiceLatency(tokenStr, method, performance.now() - start); return v; },
              (e: any) => { recordServiceLatency(tokenStr, method, performance.now() - start); throw e; },
            );
          }
          recordServiceLatency(tokenStr, method, performance.now() - start);
          return ret;
        };
        (service[method] as any).__perfWrapped = true;
      }
    }
  } catch {
    // Non-fatal
  }
}
