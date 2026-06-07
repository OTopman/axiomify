/**
 * Studio API — request proxy endpoint.
 *
 * Receives custom requests from the Studio request builder UI,
 * dispatches them directly against the memory Axiomify application instance,
 * and returns the response status, headers, and body back to the browser.
 *
 * `POST /__studio/api/request`
 */
import { compiledStates, type Axiomify } from '@axiomify/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { readBody, sendJson } from '../server/http-server';
import { extractValidationErrors } from '../utils/validation-errors';
import { recordLatency } from './perf';
import { logCorrelationStorage } from './logs';
import { recordRequest, recordResponse } from './recorder';
import { notifyReplaysUpdated, requestHistory, saveHistory } from './replay';

/**
 * The Axiomify class has private `dispatcher` and `_services` fields that we
 * need to access for profiling. We cannot intersect with `Axiomify` because
 * TypeScript reduces the result to `never` when a private member name
 * overlaps. Instead we define a standalone structural type and use
 * indexed access (`Record<string, unknown>`) to bridge the gap.
 */
interface StudioInternalApp {
  dispatcher?: {
    hooks?: {
      run?: (...args: unknown[]) => unknown;
      runSafe?: (...args: unknown[]) => unknown;
      hooks: Record<string, Array<(...args: unknown[]) => unknown>>;
    };
    router?: {
      lookup: (method: string, path: string, params: Record<string, string>) => { route?: unknown } | null;
    };
  };
  _services?: Map<unknown, unknown>;
  handle(req: unknown, res: unknown): Promise<void>;
}

/**
 * Bridge from the public Axiomify type to our internal structural type.
 * Axiomify's `dispatcher` and `_services` exist at runtime but are private
 * in the type system. We access them through `Record<string, unknown>`.
 */
function getInternalApp(app: Axiomify): StudioInternalApp {
  const indexed = app as unknown as Record<string, unknown>;
  return indexed as unknown as StudioInternalApp;
}

class AsyncLock {
  private locked = false;
  private queue: Array<() => void> = [];

  public acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

const profilingLock = new AsyncLock();

function safeClone(val: any): any {
  if (val === undefined) return undefined;
  if (val === null) return null;
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

export async function handlePostRequest(
  req: IncomingMessage,
  res: ServerResponse,
  app: Axiomify,
): Promise<void> {
  if (!app) {
    sendJson(res, { error: 'App not loaded' }, 503);
    return;
  }

  const studioApp = getInternalApp(app);

  try {
    const rawBody = await readBody(req);
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      sendJson(res, { error: 'Invalid JSON payload' }, 400);
      return;
    }

    const { method, path, headers, query, body } = payload;

    if (!path) {
      sendJson(res, { error: 'Missing "path" parameter' }, 400);
      return;
    }

    const uppercaseMethod = (method || 'GET').toUpperCase();
    const requestId = `studio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const requestTimestamp = new Date().toISOString();
    const proxyStart = performance.now();

    // Store in request history for replay
    const replayItem: any = {
      id: `replay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      method: uppercaseMethod,
      path,
      headers: headers || {},
      query: query || {},
      body,
      timestamp: requestTimestamp,
      status: undefined,
      duration: undefined,
    };
    requestHistory.push(replayItem);
    if (requestHistory.length > 50) {
      requestHistory.shift();
    }
    saveHistory();
    notifyReplaysUpdated();

    // Record to session recorder
    recordRequest({
      requestId,
      method: uppercaseMethod,
      path,
      headers: headers || {},
      query: query || {},
      body,
      timestamp: requestTimestamp,
    });

    // Reconstruct query string
    let queryString = '';
    if (query && typeof query === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      queryString = params.toString();
    } else if (typeof query === 'string') {
      queryString = query.replace(/^\?/, '');
    }

    const fullUrl = path + (queryString ? '?' + queryString : '');

    // Setup mock stream for request
    const bodyStr =
      body !== undefined
        ? typeof body === 'string'
          ? body
          : JSON.stringify(body, (_, v) => typeof v === 'bigint' ? v.toString() : v)
        : '';
    const mockStream = Readable.from(bodyStr ? [bodyStr] : []);

    const mockReq: any = {
      id: `studio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      method: uppercaseMethod,
      url: fullUrl,
      path,
      ip: '127.0.0.1',
      headers: headers || {},
      body: body,
      query: query && typeof query === 'object' ? query : {},
      params: {},
      state: {},
      raw: {},
      stream: mockStream,
    };

    let responseStatus = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: any = null;
    let responseSent = false;

    const mockRes: any = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      header(key: string, value: string) {
        responseHeaders[key.toLowerCase()] = value;
        return this;
      },
      getHeader(key: string) {
        return responseHeaders[key.toLowerCase()];
      },
      removeHeader(key: string) {
        delete responseHeaders[key.toLowerCase()];
        return this;
      },
      send(data: any, _message?: string) {
        responseSent = true;
        responseBody = data;
      },
      sendRaw(data: any, contentType?: string) {
        responseSent = true;
        responseBody = data;
        if (contentType) {
          responseHeaders['content-type'] = contentType;
        }
      },
      stream(_streamable: any, contentType?: string) {
        responseSent = true;
        responseBody = '[Streamed Content]';
        if (contentType) {
          responseHeaders['content-type'] = contentType;
        }
      },
      capabilities: { sse: false, streaming: false },
      get statusCode() {
        return responseStatus;
      },
      get headersSent() {
        return responseSent;
      },
      raw: {},
    };

    // Initialize profile
    const profile = {
      timeline: [] as any[],
      queries: [] as any[],
    };
    mockReq._profile = profile;

    // Hook, compiled-pipeline, and DB wrappers temporarily patch shared app
    // objects, so Studio serialises profiled proxy requests while the patches
    // are active. This keeps real traffic and concurrent tester clicks from
    // capturing each other's wrappers as "original" functions.
    const releaseProfileLock = await profilingLock.acquire();

    const originalRun = studioApp.dispatcher?.hooks?.run;
    const originalRunSafe = studioApp.dispatcher?.hooks?.runSafe;

    // Patch hooks if dispatcher exists
    if (studioApp.dispatcher && studioApp.dispatcher.hooks) {
      studioApp.dispatcher.hooks.run = function (type: any, ...args: any[]) {
        const req = args[0];
        if (req && req._profile) {
          const list = this.hooks[type];
          if (list.length === 0) return;

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
          return originalRun.apply(this, Array.from(arguments));
        }
      };

      studioApp.dispatcher.hooks.runSafe = function (type: any, ...args: any[]) {
        const req = type === 'onError' ? args[1] : args[0];
        if (req && req._profile) {
          const list = this.hooks[type];
          if (list.length === 0) return;

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
          return originalRunSafe.apply(this, Array.from(arguments));
        }
      };
    }

    // Dynamic database services patching
    const databaseServices: {
      obj: Record<string, unknown>;
      originalMethods: { path: string[]; fn: (...args: unknown[]) => unknown }[];
    }[] = [];
    try {
      if (studioApp._services instanceof Map) {
        for (const [token, service] of studioApp._services.entries()) {
          const tokenStr = String(token).toLowerCase();
          let isDb = false;

          let constructorName = '';
          if (service && typeof service === 'object') {
            constructorName = service.constructor?.name || '';
          }

          if (
            tokenStr.includes('db') ||
            tokenStr.includes('prisma') ||
            tokenStr.includes('mongoose') ||
            tokenStr.includes('database') ||
            constructorName.includes('PrismaClient') ||
            constructorName.includes('Mongoose') ||
            constructorName.includes('Database')
          ) {
            isDb = true;
          }

          if (isDb && service && typeof service === 'object') {
            const svc = service as Record<string, unknown>;
            const originalMethods: { path: string[]; fn: (...args: unknown[]) => unknown }[] = [];

            for (const key of Object.keys(svc)) {
              const val = svc[key];
              if (typeof val === 'function') {
                if (
                  key.startsWith('$') ||
                  key === 'query' ||
                  key === 'execute'
                ) {
                  originalMethods.push({ path: [key], fn: val as (...args: unknown[]) => unknown });
                }
              } else if (val && typeof val === 'object') {
                const model = val as Record<string, unknown>;
                for (const modelKey of Object.keys(model)) {
                  if (typeof model[modelKey] === 'function') {
                    originalMethods.push({
                      path: [key, modelKey],
                      fn: model[modelKey] as (...args: unknown[]) => unknown,
                    });
                  }
                }
                const modelProto = Object.getPrototypeOf(model);
                if (modelProto && modelProto !== Object.prototype) {
                  for (const modelKey of Object.getOwnPropertyNames(
                    modelProto,
                  )) {
                    if (
                      typeof model[modelKey] === 'function' &&
                      modelKey !== 'constructor'
                    ) {
                      originalMethods.push({
                        path: [key, modelKey],
                        fn: model[modelKey] as (...args: unknown[]) => unknown,
                      });
                    }
                  }
                }
              }
            }

            const serviceProto = Object.getPrototypeOf(svc);
            if (serviceProto && serviceProto !== Object.prototype) {
              for (const key of Object.getOwnPropertyNames(serviceProto)) {
                if (
                  typeof svc[key] === 'function' &&
                  key !== 'constructor'
                ) {
                  if (
                    key.startsWith('$') ||
                    key === 'query' ||
                    key === 'execute'
                  ) {
                    originalMethods.push({ path: [key], fn: svc[key] as (...args: unknown[]) => unknown });
                  }
                }
              }
            }

            if (originalMethods.length > 0) {
              databaseServices.push({ obj: svc, originalMethods });
            }
          }
        }
      }
    } catch {
      // Ignore
    }

    // Wrap database methods
    for (const { obj, originalMethods } of databaseServices) {
      for (const { path: methodPath, fn } of originalMethods) {
        let parent: Record<string, unknown> = obj;
        for (let i = 0; i < methodPath.length - 1; i++) {
          parent = parent[methodPath[i]] as Record<string, unknown>;
        }
        const lastKey = methodPath[methodPath.length - 1];

        parent[lastKey] = function (...args: unknown[]) {
          const start = performance.now();
          const formatQueryArgs = () => {
            try {
              const targetName = methodPath.join('.');
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
              return `${methodPath.join('.')}(...)`;
            }
          };
          const queryStr = formatQueryArgs();
          const ret = fn.apply(this, args);

          if (ret instanceof Promise) {
            return ret.then(
              (result) => {
                const duration = performance.now() - start;
                profile.queries.push({
                  query: queryStr,
                  duration,
                  timestamp: new Date().toISOString(),
                });
                return result;
              },
              (err: unknown) => {
                const duration = performance.now() - start;
                profile.queries.push({
                  query: `${queryStr} -> FAILED: ${(err instanceof Error) ? err.message : String(err)}`,
                  duration,
                  timestamp: new Date().toISOString(),
                });
                throw err;
              },
            );
          }

          const duration = performance.now() - start;
          profile.queries.push({
            query: queryStr,
            duration,
            timestamp: new Date().toISOString(),
          });
          return ret;
        };
      }
    }

    // Pipeline/Handler interception
    let originalState: any = null;
    let matchedRoute: any = null;
    if (studioApp.dispatcher && studioApp.dispatcher.router) {
      const match = studioApp.dispatcher.router.lookup(uppercaseMethod, path, {});
      if (match && match.route) {
        matchedRoute = match.route;
        originalState = compiledStates.get(matchedRoute);
        if (originalState) {
          const wrappedPipeline = originalState.pipeline.map(
            (fn: any, index: number) => {
              const stepName = fn.name || `anonymous`;
              const isHandler = index === originalState.pipeline.length - 1;
              const typeStr = isHandler ? 'handler' : 'middleware';
              const name = isHandler
                ? `Handler: ${stepName}`
                : `Middleware: ${stepName}`;

              return async function (req: any, res: any) {
                if (req && req._profile) {
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
                    if (ret instanceof Promise) {
                      await ret;
                    }
                  } catch (err: any) {
                    if (err.name === 'ValidationError') {
                      req._profile.validationErrors = extractValidationErrors(
                        err,
                        req,
                      );
                    }
                    throw err;
                  } finally {
                    const duration = performance.now() - start;
                    const cloneAfter = {
                      headers: safeClone(req.headers || {}),
                      body: safeClone(req.body || {}),
                      query: safeClone(req.query || {}),
                      params: safeClone(req.params || {}),
                      state: safeClone(req.state || {}),
                    };
                    req._profile.timeline.push({
                      name,
                      type: typeStr,
                      duration,
                      before: cloneBefore,
                      after: cloneAfter,
                    });
                  }
                } else {
                  return fn(req, res);
                }
              };
            },
          );
          compiledStates.set(matchedRoute, {
            ...originalState,
            pipeline: wrappedPipeline,
          });
        }
      }
    }

    try {
      await logCorrelationStorage.run(requestId, async () => {
        await studioApp.handle(mockReq, mockRes);
      });
    } finally {
      if (matchedRoute && originalState) {
        compiledStates.set(matchedRoute, originalState);
      }
      if (studioApp.dispatcher && studioApp.dispatcher.hooks) {
        studioApp.dispatcher.hooks.run = originalRun;
        studioApp.dispatcher.hooks.runSafe = originalRunSafe;
      }
      for (const { obj, originalMethods } of databaseServices) {
        for (const { path: methodPath, fn } of originalMethods) {
          let parent: Record<string, unknown> = obj;
          for (let i = 0; i < methodPath.length - 1; i++) {
            parent = parent[methodPath[i]] as Record<string, unknown>;
          }
          const lastKey = methodPath[methodPath.length - 1];
          parent[lastKey] = fn;
        }
      }
      releaseProfileLock();
    }

    // Push to recorder and perf observatory
    const proxyDuration = performance.now() - proxyStart;
    recordResponse({
      requestId,
      status: responseStatus,
      headers: responseHeaders,
      body: responseBody,
      durationMs: Math.round(proxyDuration * 100) / 100,
      timestamp: new Date().toISOString(),
      timeline: mockReq._profile?.timeline,
    });

    // Update the replay item in history on request completion
    replayItem.status = responseStatus;
    replayItem.duration = Math.round(proxyDuration * 100) / 100;
    saveHistory();
    notifyReplaysUpdated();

    // Feed perf stats from the profiled timeline
    const timeline = (mockReq._profile?.timeline || []) as { name: string; type: string; duration: number }[];
    const queryDurations = (mockReq._profile?.queries || []).map((q: any) => ({
      query: String(q.query),
      durationMs: q.duration,
    }));
    recordLatency(path, uppercaseMethod, proxyDuration, timeline, queryDurations);

    // Respond back to the studio client
    sendJson(res, {
      status: responseStatus,
      headers: responseHeaders,
      body: responseBody,
      profile: mockReq._profile,
    });
  } catch (err) {
    sendJson(
      res,
      {
        error: 'Failed to proxy request',
        message: (err as Error).message,
      },
      500,
    );
  }
}
