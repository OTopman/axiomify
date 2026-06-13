import { AsyncLocalStorage } from 'node:async_hooks';
import * as path from 'node:path';
import type { Axiomify } from './app';
import { compiledStates } from './compiled';
import type { RouteDefinition } from './types';

const telemetryRequestStorage = new AsyncLocalStorage<string>();

const req = typeof require !== 'undefined' ? require : undefined;

function loadPackage(pkgName: string): any {
  if (!req) {
    throw new Error(`[Axiomify Tracing] require is not defined. Tracing requires Node.js environment.`);
  }
  try {
    return req(pkgName);
  } catch {
    throw new Error(
      `[Axiomify Tracing] Missing package "${pkgName}". Please run:\n` +
      `  npm install @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/sdk-logs @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/exporter-logs-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions`
    );
  }
}

export function setupTelemetry(app: Axiomify) {
  // Load standard OTel packages dynamically to prevent core package bloat
  const api = loadPackage('@opentelemetry/api');
  const apiLogs = loadPackage('@opentelemetry/api-logs');
  const { NodeTracerProvider, SimpleSpanProcessor } = loadPackage('@opentelemetry/sdk-trace-node');
  const { MeterProvider, PeriodicExportingMetricReader } = loadPackage('@opentelemetry/sdk-metrics');
  const { LoggerProvider, SimpleLogRecordProcessor } = loadPackage('@opentelemetry/sdk-logs');
  const { OTLPTraceExporter } = loadPackage('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = loadPackage('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPLogExporter } = loadPackage('@opentelemetry/exporter-logs-otlp-http');
  const { resourceFromAttributes } = loadPackage('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = loadPackage('@opentelemetry/semantic-conventions');

  // Verify if already registered to avoid duplicate setup
  if ((app as any).__otelInitialized) return;
  (app as any).__otelInitialized = true;

  const serviceName = process.env.OTEL_SERVICE_NAME || 'axiomify-app';

  // 1. Build Resource
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  });

  // Determine export URLs if Studio is active
  const isStudio = process.env.AXIOMIFY_STUDIO === 'true';
  const studioPort = process.env.AXIOMIFY_STUDIO_PORT || '4399';
  const studioToken = process.env.AXIOMIFY_STUDIO_TOKEN || '';

  const traceExporterOptions: any = {};
  const metricExporterOptions: any = {};
  const logExporterOptions: any = {};

  const studioUrl = `http://localhost:${studioPort}/__studio/otlp`;
  const headers = studioToken ? { 'Authorization': `Bearer ${studioToken}` } : undefined;

  if (isStudio || (!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    traceExporterOptions.url = `${studioUrl}/v1/traces`;
    if (headers) {
      traceExporterOptions.headers = headers;
    }
  }

  if (isStudio || (!process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    metricExporterOptions.url = `${studioUrl}/v1/metrics`;
    if (headers) {
      metricExporterOptions.headers = headers;
    }
  }

  if (isStudio || (!process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    logExporterOptions.url = `${studioUrl}/v1/logs`;
    if (headers) {
      logExporterOptions.headers = headers;
    }
  }

  // 2. Setup Tracer
  const traceExporter = new OTLPTraceExporter(traceExporterOptions);
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(traceExporter)],
  });
  tracerProvider.register();

  // 3. Setup Metrics
  const metricExporter = new OTLPMetricExporter(metricExporterOptions);
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 5000,
      }),
    ],
  });
  api.metrics.setGlobalMeterProvider(meterProvider);

  // 4. Setup Logs
  const logExporter = new OTLPLogExporter(logExporterOptions);
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  apiLogs.logs.setGlobalLoggerProvider(loggerProvider);

  // Hook standard logs, errors, and writes to emit to OpenTelemetry Logs
  if (!(globalThis as any).__axiomifyOtelLogsInstrumented) {
    (globalThis as any).__axiomifyOtelLogsInstrumented = true;
    instrumentOtelLogs(loggerProvider);
  }

  const tracer = api.trace.getTracer('axiomify');
  const meter = api.metrics.getMeter('axiomify');

  // Define metrics
  const requestCounter = meter.createCounter('http_requests_total', {
    description: 'Total number of HTTP requests.',
  });
  const durationHistogram = meter.createHistogram('http_request_duration_ms', {
    description: 'Duration of HTTP requests in ms.',
  });

  // Helper to wrap route pipeline steps
  function wrapRoutePipeline(route: RouteDefinition) {
    const state = compiledStates.get(route);
    if (!state || (state as any).__otelWrapped) return;

    const wrappedPipeline = state.pipeline.map((fn, index) => {
      const stepName = fn.name || `step-${index}`;
      const isHandler = index === state.pipeline.length - 1;
      const typeStr = isHandler ? 'handler' : 'middleware';
      const label = isHandler ? `Handler: ${stepName}` : `Middleware: ${stepName}`;

      return async function otelWrappedStep(req: any, res: any) {
        const activeSpan = api.trace.getActiveSpan();
        if (!activeSpan) {
          return fn(req, res);
        }

        const span = tracer.startSpan(label, {
          attributes: {
            'axiomify.type': typeStr,
          },
        });

        return api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
          try {
            const ret = fn(req, res);
            if (ret instanceof Promise) await ret;
          } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
            throw err;
          } finally {
            span.end();
          }
        });
      };
    });

    state.pipeline = wrappedPipeline;
    (state as any).__otelWrapped = true;
  }

  // Helper to wrap DI service methods
  function wrapServiceMethods(appInstance: any) {
    const services = appInstance._services;
    if (!(services instanceof Map)) return;

    for (const [token, service] of services.entries()) {
      if (!service || typeof service !== 'object') continue;
      const tokenStr = String(token).toLowerCase();
      
      const isNamedService =
        tokenStr.length > 2 &&
        !['config', 'options', 'env', 'logger', 'tokenstore', 'limiter', 'metrics'].some(w => tokenStr.includes(w));
      if (!isNamedService) continue;

      const proto = Object.getPrototypeOf(service);
      const methods = proto && proto !== Object.prototype
        ? Object.getOwnPropertyNames(proto).filter(k => k !== 'constructor' && typeof service[k] === 'function')
        : Object.keys(service).filter(k => typeof service[k] === 'function');

      for (const method of methods) {
        const original = service[method];
        if (typeof original !== 'function' || (original as any).__otelWrapped) continue;

        service[method] = function (...args: any[]) {
          const activeSpan = api.trace.getActiveSpan();
          if (!activeSpan) {
            return original.apply(this, args);
          }

          const label = `Service Call: ${tokenStr}.${method}`;
          const span = tracer.startSpan(label, {
            attributes: {
              'axiomify.type': 'service',
              'service.method': method,
              'service.token': tokenStr,
            },
          });

          try {
            const serializedArgs = args.map(arg => {
              if (typeof arg === 'object') {
                return JSON.stringify(arg, (_, v) => typeof v === 'bigint' ? v.toString() : v);
              }
              return String(arg);
            }).join(', ');
            span.setAttribute('service.args', serializedArgs);
          } catch {
            // ignore
          }

          return api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
            try {
              const ret = original.apply(this, args);
              if (ret instanceof Promise) {
                return await ret;
              }
              return ret;
            } catch (err: any) {
              span.recordException(err);
              span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
              throw err;
            } finally {
              span.end();
            }
          });
        };
        (service[method] as any).__otelWrapped = true;
      }
    }
  }

  // 5. Intercept request handler inside the dispatcher
  const dispatcher = (app as any).dispatcher;
  if (dispatcher) {
    const originalHandle = dispatcher.handle;
    dispatcher.handle = async function (req: any, res: any) {
      if (req.path.startsWith('/__studio/')) {
        return originalHandle.call(this, req, res);
      }

      const requestId = req.id || '';
      return telemetryRequestStorage.run(requestId, async () => {
        const startTime = performance.now();
        const spanName = `${req.method} ${req.path}`;
        const span = tracer.startSpan(spanName, {
          kind: api.SpanKind.SERVER,
          attributes: {
            'http.method': req.method,
            'http.url': req.url || req.path,
            'http.target': req.path,
            'http.client_ip': req.ip || '',
            'http.user_agent': req.headers['user-agent'] || '',
            'x-request-id': req.id || '',
          },
        });

        return api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
          try {
            await originalHandle.call(this, req, res);
          } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
            throw err;
          } finally {
            const duration = performance.now() - startTime;
            const status = res.statusCode || 200;
            
            span.setAttribute('http.status_code', status);
            span.end();

            // Record metrics
            const labels = {
              method: req.method,
              route: (req.state && req.state.metricsRouteLabel) || req.path,
              status: String(status),
            };
            requestCounter.add(1, labels);
            durationHistogram.record(duration, labels);
          }
        });
      });
    };

    const originalHandleMatchedRoute = dispatcher.handleMatchedRoute;
    if (originalHandleMatchedRoute) {
      dispatcher.handleMatchedRoute = async function (
        req: any,
        res: any,
        route: any,
        params: any,
      ) {
        if (req.path.startsWith('/__studio/')) {
          return originalHandleMatchedRoute.call(this, req, res, route, params);
        }

        const requestId = req.id || '';
        return telemetryRequestStorage.run(requestId, async () => {
          const startTime = performance.now();
          const spanName = `${req.method} ${route.path}`;
          const span = tracer.startSpan(spanName, {
            kind: api.SpanKind.SERVER,
            attributes: {
              'http.method': req.method,
              'http.url': req.url || req.path,
              'http.target': req.path,
              'http.route': route.path,
              'http.client_ip': req.ip || '',
              'http.user_agent': req.headers['user-agent'] || '',
              'x-request-id': req.id || '',
            },
          });

          return api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
            try {
              await originalHandleMatchedRoute.call(this, req, res, route, params);
            } catch (err: any) {
              span.recordException(err);
              span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message });
              throw err;
            } finally {
              const duration = performance.now() - startTime;
              const status = res.statusCode || 200;

              span.setAttribute('http.status_code', status);
              span.end();

              // Record metrics
              const labels = {
                method: req.method,
                route: route.path,
                status: String(status),
              };
              requestCounter.add(1, labels);
              durationHistogram.record(duration, labels);
            }
          });
        });
      };
    }
  }

  // Wrap all pipelines currently registered
  for (const route of app.registeredRoutes) {
    wrapRoutePipeline(route);
  }

  // Wrap all services currently registered
  wrapServiceMethods(app);

  // Patch methods to wrap future registrations
  const originalRoute = app.route;
  app.route = function (definition: any) {
    const result = originalRoute.call(this, definition);
    wrapRoutePipeline(definition);
    return result;
  };

  const originalWs = app.ws;
  app.ws = function (definition: any) {
    const result = originalWs.call(this, definition);
    wrapRoutePipeline(definition as any);
    return result;
  };

  const originalUse = app.use;
  app.use = function (configurator: any) {
    const result = originalUse.call(this, configurator);
    wrapServiceMethods(app);
    return result;
  };
}

function instrumentOtelLogs(loggerProvider: any): void {
  const otelLogger = loggerProvider.getLogger('axiomify');

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'> =
    ['log', 'info', 'warn', 'error', 'debug', 'trace'];

  let inConsoleCall = false;

  const originalConsole: Record<string, any> = {};
  methods.forEach((method) => {
    originalConsole[method] = (console as any)[method];
    (console as any)[method] = function (...args: any[]) {
      originalConsole[method].apply(console, args);

      if (inConsoleCall) return;
      inConsoleCall = true;

      try {
        let message = '';
        try {
          message = args
            .map((arg) => {
              if (arg instanceof Error) {
                return arg.stack || arg.message;
              }
              if (typeof arg === 'object' && arg !== null) {
                try {
                  return JSON.stringify(arg);
                } catch {
                  return String(arg);
                }
              }
              return String(arg);
            })
            .join(' ');
        } catch {
          message = '[Unformattable Log Message]';
        }

        let severityText = 'INFO';
        let severityNumber = 9;
        if (method === 'warn') {
          severityText = 'WARN';
          severityNumber = 13;
        } else if (method === 'error') {
          severityText = 'ERROR';
          severityNumber = 17;
        } else if (method === 'debug') {
          severityText = 'DEBUG';
          severityNumber = 5;
        } else if (method === 'trace') {
          severityText = 'TRACE';
          severityNumber = 1;
        }

        const attributes: Record<string, any> = {};
        const requestId = telemetryRequestStorage.getStore();
        if (requestId) {
          attributes['request_id'] = requestId;
        }

        // Capture source code location
        try {
          const err = new Error();
          const rawStack = err.stack || '';
          const lines = rawStack.split('\n');
          const callerLine = lines.find((line) => {
            return !line.includes('node:internal') &&
                   !line.includes('telemetry.js') &&
                   !line.includes('telemetry.ts') &&
                   !line.includes('console.ts') &&
                   !line.includes('Error');
          });
          if (callerLine) {
            const match = /(?:\(|at\s+)([^\s()]+?):(\d+)(?::(\d+))?\)?$/.exec(callerLine.trim());
            if (match) {
              const filePath = match[1];
              const relativePath = path.isAbsolute(filePath)
                ? path.relative(process.cwd(), filePath)
                : filePath;
              attributes['code.filepath'] = relativePath;
              attributes['code.lineno'] = parseInt(match[2], 10);
            }
          }
        } catch {
          // ignore
        }

        otelLogger.emit({
          body: message,
          severityText,
          severityNumber,
          attributes,
        });
      } catch {
        // ignore
      } finally {
        inConsoleCall = false;
      }
    };
  });

  // Intercept process.stdout.write
  const originalStdoutWrite = process.stdout.write;
  process.stdout.write = function (chunk: any, encoding?: any, callback?: any): boolean {
    if (inConsoleCall) {
      return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
    }
    inConsoleCall = true;
    try {
      const message = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (message.trim()) {
        const attributes: Record<string, any> = {};
        const requestId = telemetryRequestStorage.getStore();
        if (requestId) {
          attributes['request_id'] = requestId;
        }
        otelLogger.emit({
          body: message,
          severityText: 'INFO',
          severityNumber: 9,
          attributes,
        });
      }
    } catch {
      // Ignore
    } finally {
      inConsoleCall = false;
    }
    return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
  } as any;

  // Intercept process.stderr.write
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = function (chunk: any, encoding?: any, callback?: any): boolean {
    if (inConsoleCall) {
      return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
    }
    inConsoleCall = true;
    try {
      const message = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (message.trim()) {
        const attributes: Record<string, any> = {};
        const requestId = telemetryRequestStorage.getStore();
        if (requestId) {
          attributes['request_id'] = requestId;
        }
        otelLogger.emit({
          body: message,
          severityText: 'ERROR',
          severityNumber: 17,
          attributes,
        });
      }
    } catch {
      // Ignore
    } finally {
      inConsoleCall = false;
    }
    return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
  } as any;
}

