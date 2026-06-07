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
import { recordRequest, recordResponse, recordQuery } from './recorder';
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContextStorage = new AsyncLocalStorage<any>();

function safeClone(val: any): any {
  if (val === undefined) return undefined;
  if (val === null) return null;
  try {
    const str = JSON.stringify(val, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    if (str.length > 50000) {
      return '[Payload too large (>50KB) — skipped]';
    }
  } catch {
    return '[Unserializable Payload]';
  }

  const seen = new WeakSet();
  function clone(item: any): any {
    if (typeof item === 'bigint') {
      return String(item);
    }
    if (item === null || typeof item !== 'object') {
      return item;
    }
    if (seen.has(item)) {
      return '[Circular]';
    }
    seen.add(item);

    if (Array.isArray(item)) {
      return item.map(i => clone(i));
    }

    const obj: any = {};
    for (const key of Object.keys(item)) {
      try {
        obj[key] = clone(item[key]);
      } catch (e) {
        obj[key] = '[Uncloneable]';
      }
    }
    return obj;
  }

  return clone(val);
}

/**
 * Instruments the given Axiomify app to track real production
 * request latencies for all routes, middleware, hooks, and DB services.
 */
export function instrumentTrafficProfiling(app: any): void {
  if (!app) return;

  try {
    // ── Per-request timing via onRequest / onPostHandler ─────────────
    app.addHook('onRequest', (req: any, res: any) => {
      if (!req) return;
      // Skip Studio's own internal requests
      const path = req.path || (req.url ? new URL(req.url, 'http://x').pathname : '/');
      if (path.startsWith('/__studio/')) return;
      
      req.id = req.id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      req.__perfStart = performance.now();
      
      // Initialize profile container
      req._profile = {
        timeline: [],
        queries: [],
      };

      // Record to session recorder
      recordRequest({
        requestId: req.id,
        method: (req.method || 'GET').toUpperCase(),
        path,
        headers: safeClone(req.headers || {}),
        query: safeClone(req.query || {}),
        body: safeClone(req.body || {}),
        timestamp: new Date().toISOString(),
      });

      // Wrap response methods to capture body, headers, status
      if (res) {
        let responseStatus = 200;
        const responseHeaders: Record<string, string> = {};
        let responseBody: any = null;

        const originalStatus = res.status;
        res.status = function(code: number) {
          responseStatus = code;
          return originalStatus.apply(this, arguments);
        };

        const originalHeader = res.header;
        res.header = function(key: string, value: string) {
          responseHeaders[key.toLowerCase()] = value;
          return originalHeader.apply(this, arguments);
        };

        const originalSend = res.send;
        res.send = function(data: any) {
          responseBody = data;
          return originalSend.apply(this, arguments);
        };

        const originalSendRaw = res.sendRaw;
        if (originalSendRaw) {
          res.sendRaw = function(data: any, contentType?: string) {
            responseBody = data;
            if (contentType) responseHeaders['content-type'] = contentType;
            return originalSendRaw.apply(this, arguments);
          };
        }

        const originalStream = res.stream;
        if (originalStream) {
          res.stream = function(streamable: any, contentType?: string) {
            responseBody = '[Streamed Content]';
            if (contentType) responseHeaders['content-type'] = contentType;
            return originalStream.apply(this, arguments);
          };
        }

        req._capturedResponse = {
          getStatus: () => responseStatus,
          getHeaders: () => responseHeaders,
          getBody: () => responseBody,
        };
      }
    });

    app.addHook('onPostHandler', (req: any, _res: any) => {
      if (!req || req.__perfStart == null) return;
      const path = req.path || (req.url ? new URL(req.url, 'http://x').pathname : '/');
      if (path.startsWith('/__studio/')) return;

      const totalDuration = performance.now() - req.__perfStart;
      const method = (req.method || 'GET').toUpperCase();
      
      const timeline = (req._profile?.timeline || req.__perfTimeline || []) as { name: string; type: string; duration: number }[];
      const queryDurations = (req._profile?.queries || []).map((q: any) => ({
        query: String(q.query),
        durationMs: q.durationMs,
      }));

      // Record latency globally
      recordLatency(path, method, totalDuration, timeline, queryDurations);

      // Record to session recorder
      if (req._capturedResponse) {
        recordResponse({
          requestId: req.id,
          status: req._capturedResponse.getStatus(),
          headers: req._capturedResponse.getHeaders(),
          body: safeClone(req._capturedResponse.getBody()),
          durationMs: Math.round(totalDuration * 100) / 100,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // ── Patch hook executor in the dispatcher ────────────────────────
    const dispatcher = app.dispatcher;
    if (dispatcher && dispatcher.hooks && !dispatcher.hooks.__perfWrapped) {
      const originalRun = dispatcher.hooks.run;
      const originalRunSafe = dispatcher.hooks.runSafe;

      dispatcher.hooks.run = function (type: any, ...args: any[]) {
        const req = args[0];
        if (req && req._profile) {
          const list = this.hooks[type];
          if (!list || list.length === 0) return;

          if (list.length === 1) {
            const fn = list[0];
            const fnName = fn.name || 'anonymous';
            const start = performance.now();
            const ret = fn(...args);
            if (ret instanceof Promise) {
              return ret.then(() => {
                req._profile.timeline.push({
                  name: `Hook: ${type} (${fnName})`,
                  type: 'hook',
                  duration: performance.now() - start,
                });
              });
            } else {
              req._profile.timeline.push({
                name: `Hook: ${type} (${fnName})`,
                type: 'hook',
                duration: performance.now() - start,
              });
              return;
            }
          }

          const execute = async () => {
            const snapshot = list.slice();
            for (const fn of snapshot) {
              const fnName = fn.name || 'anonymous';
              const start = performance.now();
              await fn(...args);
              req._profile.timeline.push({
                name: `Hook: ${type} (${fnName})`,
                type: 'hook',
                duration: performance.now() - start,
              });
            }
          };
          return execute();
        }
        if (originalRun) {
          return originalRun.call(this, type, ...args);
        }
      };

      dispatcher.hooks.runSafe = function (type: any, ...args: any[]) {
        const req = type === 'onError' ? args[1] : args[0];
        if (req && req._profile) {
          const list = this.hooks[type];
          if (!list || list.length === 0) return;

          if (list.length === 1) {
            const fn = list[0];
            const fnName = fn.name || 'anonymous';
            const start = performance.now();
            try {
              const ret = fn(...args);
              if (ret instanceof Promise) {
                return ret.then(
                  () => {
                    req._profile.timeline.push({
                      name: `Hook: ${type} (${fnName})`,
                      type: 'hook',
                      duration: performance.now() - start,
                    });
                  },
                  () => {
                    req._profile.timeline.push({
                      name: `Hook: ${type} (${fnName})`,
                      type: 'hook',
                      duration: performance.now() - start,
                    });
                  },
                );
              } else {
                req._profile.timeline.push({
                  name: `Hook: ${type} (${fnName})`,
                  type: 'hook',
                  duration: performance.now() - start,
                });
                return;
              }
            } catch {
              req._profile.timeline.push({
                name: `Hook: ${type} (${fnName})`,
                type: 'hook',
                duration: performance.now() - start,
              });
              return;
            }
          }

          const execute = async () => {
            const snapshot = list.slice();
            for (const fn of snapshot) {
              const fnName = fn.name || 'anonymous';
              const start = performance.now();
              try {
                await fn(...args);
              } catch {
                // swallow
              }
              req._profile.timeline.push({
                name: `Hook: ${type} (${fnName})`,
                type: 'hook',
                duration: performance.now() - start,
              });
            }
          };
          return execute();
        }
        if (originalRunSafe) {
          return originalRunSafe.call(this, type, ...args);
        }
      };

      dispatcher.hooks.__perfWrapped = true;
    }

    // Wrap pipelines and DI services.
    _wrapCompiledPipelines(app);
    _wrapServiceMethods(app);
  } catch {
    // Non-fatal
  }
}

/**
 * Wraps the compiled pipeline of every registered route with timing shims.
 */
function _wrapCompiledPipelines(app: any): void {
  try {
    if (!app.registeredRoutes || !compiledStates) return;

    for (const route of app.registeredRoutes) {
      const state = compiledStates.get(route);
      if (!state || !Array.isArray(state.pipeline)) continue;

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
            const cloneBefore = {
              headers: safeClone(req.headers || {}),
              body: safeClone(req.body || {}),
              query: safeClone(req.query || {}),
              params: safeClone(req.params || {}),
              state: safeClone(req.state || {}),
            };

            try {
              const ret = fn(req, res);
              if (ret instanceof Promise) await ret;
            } finally {
              const duration = performance.now() - start;
              const cloneAfter = {
                headers: safeClone(req.headers || {}),
                body: safeClone(req.body || {}),
                query: safeClone(req.query || {}),
                params: safeClone(req.params || {}),
                state: safeClone(req.state || {}),
              };

              if (!req.__perfTimeline) req.__perfTimeline = [];
              req.__perfTimeline.push({ name: label, type: typeStr, duration });

              if (req._profile) {
                req._profile.timeline.push({
                  name: label,
                  type: typeStr,
                  duration,
                  before: cloneBefore,
                  after: cloneAfter,
                });
              }
            }
          };

          return requestContextStorage.run(req, () => {
            if (req && req.id) {
              return logCorrelationStorage.run(req.id, runStep);
            } else {
              return runStep();
            }
          });
        };
      });

      compiledStates.set(route, { ...state, pipeline: wrappedPipeline, __perfWrapped: true } as any);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Wraps DI service methods for database/service packages.
 */
function _wrapServiceMethods(app: any): void {
  try {
    if (!(app._services instanceof Map)) return;

    for (const [token, service] of app._services.entries()) {
      if (!service || typeof service !== 'object') continue;
      const tokenStr = String(token).toLowerCase();
      const ctorName = (service.constructor?.name || '').toLowerCase();

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
          const req = requestContextStorage.getStore();

          const formatQueryArgs = () => {
            try {
              const targetName = `${tokenStr}.${method}`;
              const serializedArgs = args
                .map((arg) => {
                  if (typeof arg === 'object') {
                    return JSON.stringify(arg, (_, v) => typeof v === 'bigint' ? v.toString() : v);
                  }
                  return String(arg);
                })
                .join(', ');
              return `${targetName}(${serializedArgs})`;
            } catch {
              return `${tokenStr}.${method}(...)`;
            }
          };

          const handleResult = (isError: boolean, errOrVal: any) => {
            const duration = performance.now() - start;
            recordServiceLatency(tokenStr, method, duration);

            if (req && req._profile) {
              const queryStr = formatQueryArgs();
              const displayQuery = isError
                ? `${queryStr} -> FAILED: ${errOrVal instanceof Error ? errOrVal.message : String(errOrVal)}`
                : queryStr;

              req._profile.queries.push({
                query: displayQuery,
                durationMs: duration,
                timestamp: new Date().toISOString(),
              });

              req._profile.timeline.push({
                name: `Service Call: ${tokenStr}.${method}`,
                type: 'service',
                duration,
              });

              recordQuery({
                requestId: req.id,
                query: displayQuery,
                durationMs: duration,
                failed: isError,
                timestamp: new Date().toISOString(),
              });
            }
          };

          let ret: any;
          try {
            ret = original.apply(this, args);
          } catch (err) {
            handleResult(true, err);
            throw err;
          }

          if (ret instanceof Promise) {
            return ret.then(
              (v: any) => {
                handleResult(false, v);
                return v;
              },
              (e: any) => {
                handleResult(true, e);
                throw e;
              },
            );
          }

          handleResult(false, ret);
          return ret;
        };
        (service[method] as any).__perfWrapped = true;
      }
    }
  } catch {
    // Non-fatal
  }
}
