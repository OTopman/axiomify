/**
 * Studio API — request proxy endpoint.
 *
 * Receives custom requests from the Studio request builder UI,
 * dispatches them directly against the memory Axiomify application instance,
 * and returns the response status, headers, and body back to the browser.
 *
 * `POST /__studio/api/request`
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { sendJson, readBody } from '../server/http-server';
import { compiledStates } from '@axiomify/core';
import { requestHistory, saveHistory } from './replay';

let activeProfile: any = null;

export async function handlePostRequest(
  req: IncomingMessage,
  res: ServerResponse,
  app: any,
): Promise<void> {
  if (!app) {
    sendJson(res, { error: 'App not loaded' }, 503);
    return;
  }

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

    // Store in request history for replay
    requestHistory.push({
      id: `replay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      method: uppercaseMethod,
      path,
      headers: headers || {},
      query: query || {},
      body,
      timestamp: new Date().toISOString(),
    });
    if (requestHistory.length > 50) {
      requestHistory.shift();
    }
    saveHistory();

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
    const bodyStr = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const mockStream = Readable.from(bodyStr ? [bodyStr] : []);

    const mockReq: any = {
      id: `studio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      method: uppercaseMethod,
      url: fullUrl,
      path,
      ip: '127.0.0.1',
      headers: headers || {},
      body: body,
      query: (query && typeof query === 'object') ? query : {},
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
    activeProfile = profile;

    const originalRun = app.dispatcher?.hooks?.run;
    const originalRunSafe = app.dispatcher?.hooks?.runSafe;

    // Patch hooks if dispatcher exists
    if (app.dispatcher && app.dispatcher.hooks) {
      app.dispatcher.hooks.run = function(type: any, ...args: any[]) {
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
        return originalRun.apply(this, arguments);
      };

      app.dispatcher.hooks.runSafe = function(type: any, ...args: any[]) {
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
                  }
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
        return originalRunSafe.apply(this, arguments);
      };
    }

    // Dynamic database services patching
    const databaseServices: { obj: any; originalMethods: { path: string[]; fn: any }[] }[] = [];
    try {
      if (app._services instanceof Map) {
        for (const [token, service] of app._services.entries()) {
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
            const originalMethods: { path: string[]; fn: any }[] = [];
            
            for (const key of Object.keys(service)) {
              const val = service[key];
              if (typeof val === 'function') {
                if (key.startsWith('$') || key === 'query' || key === 'execute') {
                  originalMethods.push({ path: [key], fn: val });
                }
              } else if (val && typeof val === 'object') {
                for (const modelKey of Object.keys(val)) {
                  if (typeof val[modelKey] === 'function') {
                    originalMethods.push({ path: [key, modelKey], fn: val[modelKey] });
                  }
                }
                const modelProto = Object.getPrototypeOf(val);
                if (modelProto && modelProto !== Object.prototype) {
                  for (const modelKey of Object.getOwnPropertyNames(modelProto)) {
                    if (typeof val[modelKey] === 'function' && modelKey !== 'constructor') {
                      originalMethods.push({ path: [key, modelKey], fn: val[modelKey] });
                    }
                  }
                }
              }
            }
            
            const serviceProto = Object.getPrototypeOf(service);
            if (serviceProto && serviceProto !== Object.prototype) {
              for (const key of Object.getOwnPropertyNames(serviceProto)) {
                if (typeof service[key] === 'function' && key !== 'constructor') {
                  if (key.startsWith('$') || key === 'query' || key === 'execute') {
                    originalMethods.push({ path: [key], fn: service[key] });
                  }
                }
              }
            }

            if (originalMethods.length > 0) {
              databaseServices.push({ obj: service, originalMethods });
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
        let parent = obj;
        for (let i = 0; i < methodPath.length - 1; i++) {
          parent = parent[methodPath[i]];
        }
        const lastKey = methodPath[methodPath.length - 1];

        parent[lastKey] = function(...args: any[]) {
          if (activeProfile) {
            const start = performance.now();
            const formatQueryArgs = () => {
              try {
                const targetName = methodPath.join('.');
                const serializedArgs = args.map(arg => {
                  if (typeof arg === 'object') {
                    return JSON.stringify(arg);
                  }
                  return String(arg);
                }).join(', ');
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
                  activeProfile.queries.push({
                    query: queryStr,
                    duration,
                    timestamp: new Date().toISOString(),
                  });
                  return result;
                },
                (err) => {
                  const duration = performance.now() - start;
                  activeProfile.queries.push({
                    query: `${queryStr} -> FAILED: ${err.message}`,
                    duration,
                    timestamp: new Date().toISOString(),
                  });
                  throw err;
                }
              );
            } else {
              const duration = performance.now() - start;
              activeProfile.queries.push({
                query: queryStr,
                duration,
                timestamp: new Date().toISOString(),
              });
              return ret;
            }
          }
          return fn.apply(this, args);
        };
      }
    }

    // Pipeline/Handler interception
    let originalState: any = null;
    let matchedRoute: any = null;
    if (app.dispatcher && app.dispatcher.router) {
      const match = app.dispatcher.router.lookup(uppercaseMethod, path, {});
      if (match && match.route) {
        matchedRoute = match.route;
        originalState = compiledStates.get(matchedRoute);
        if (originalState) {
          const wrappedPipeline = originalState.pipeline.map((fn: any, index: number) => {
            let stepName = fn.name || `anonymous`;
            const isHandler = index === originalState.pipeline.length - 1;
            const typeStr = isHandler ? 'handler' : 'middleware';
            const name = isHandler ? `Handler: ${stepName}` : `Middleware: ${stepName}`;
            
            return async function(req: any, res: any) {
              if (req && req._profile) {
                const start = performance.now();
                try {
                  const ret = fn(req, res);
                  if (ret instanceof Promise) {
                    await ret;
                  }
                } catch (err: any) {
                  if (err.name === 'ValidationError') {
                    const validationErrors: Array<{ location: string; field: string; reason: string; received: any }> = [];
                    if (err.errors) {
                      for (const [location, fieldErrors] of Object.entries(err.errors)) {
                        if (fieldErrors && typeof fieldErrors === 'object') {
                          for (const [field, reason] of Object.entries(fieldErrors as any)) {
                            let received: any = undefined;
                            const reqSource = (req as any)[location];
                            if (reqSource && typeof reqSource === 'object') {
                              const parts = field.split('.');
                              let current = reqSource;
                              for (const p of parts) {
                                current = (current as any)?.[p];
                              }
                              received = current;
                            }
                            validationErrors.push({
                              location,
                              field,
                              reason: String(reason),
                              received,
                            });
                          }
                        }
                      }
                    }
                    req._profile.validationErrors = validationErrors;
                  }
                  throw err;
                } finally {
                  const duration = performance.now() - start;
                  req._profile.timeline.push({
                    name,
                    type: typeStr,
                    duration,
                  });
                }
              } else {
                return fn(req, res);
              }
            };
          });
          compiledStates.set(matchedRoute, {
            ...originalState,
            pipeline: wrappedPipeline,
          });
        }
      }
    }

    try {
      await app.handle(mockReq, mockRes);
    } finally {
      activeProfile = null;
      if (matchedRoute && originalState) {
        compiledStates.set(matchedRoute, originalState);
      }
      if (app.dispatcher && app.dispatcher.hooks) {
        app.dispatcher.hooks.run = originalRun;
        app.dispatcher.hooks.runSafe = originalRunSafe;
      }
      for (const { obj, originalMethods } of databaseServices) {
        for (const { path: methodPath, fn } of originalMethods) {
          let parent = obj;
          for (let i = 0; i < methodPath.length - 1; i++) {
            parent = parent[methodPath[i]];
          }
          const lastKey = methodPath[methodPath.length - 1];
          parent[lastKey] = fn;
        }
      }
    }

    // Respond back to the studio client
    sendJson(res, {
      status: responseStatus,
      headers: responseHeaders,
      body: responseBody,
      profile: mockReq._profile,
    });
  } catch (err) {
    sendJson(res, {
      error: 'Failed to proxy request',
      message: (err as Error).message,
    }, 500);
  }
}
