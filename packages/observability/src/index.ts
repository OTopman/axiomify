import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

/** W3C propagation fields made available to all request hooks and handlers. */
export interface TraceContext {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}

export interface TimingHandle {
  /** Stops this measurement. Calling it more than once is harmless. */
  end(): void;
}

export interface RequestTimings {
  /** Start a named measurement and return a handle that stops it. */
  start(name: string): TimingHandle;
  /** Stop the most recently-open measurement with this name. */
  end(name: string): void;
}

export interface ObservabilityOptions {
  /**
   * Adds a `Server-Timing` response header. Enabled by default.
   * Applications can use `req.state.timings` to contribute named spans.
   */
  serverTiming?: boolean;
  /** Expose incoming `traceparent`, `tracestate`, and `baggage` in request state. */
  traceContext?: boolean;
  /** State key used for request timings. Defaults to `timings`. */
  timingsStateKey?: string;
  /** State key used for the extracted W3C context. Defaults to `traceContext`. */
  traceContextStateKey?: string;
}

interface Measurement {
  name: string;
  startedAt: bigint;
  endedAt?: bigint;
}

const HTTP_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function headerValue(
  headers: AxiomifyRequest['headers'],
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function durationMs(start: bigint, end: bigint): number {
  return Number(end - start) / 1_000_000;
}

function formatDuration(value: number): string {
  return Math.max(0, value)
    .toFixed(3)
    .replace(/\.000$/, '');
}

function createTimings(startedAt: bigint): {
  timings: RequestTimings;
  serialize(endAt: bigint): string;
} {
  const measurements: Measurement[] = [];

  const timings: RequestTimings = {
    start(name) {
      if (!HTTP_TOKEN.test(name)) {
        throw new Error(
          `[@axiomify/observability] Invalid Server-Timing metric name "${name}".`,
        );
      }
      const measurement: Measurement = {
        name,
        startedAt: process.hrtime.bigint(),
      };
      measurements.push(measurement);
      return {
        end: () => {
          measurement.endedAt ??= process.hrtime.bigint();
        },
      };
    },
    end(name) {
      for (let index = measurements.length - 1; index >= 0; index -= 1) {
        const measurement = measurements[index];
        if (measurement.name === name && measurement.endedAt === undefined) {
          measurement.endedAt = process.hrtime.bigint();
          return;
        }
      }
    },
  };

  return {
    timings,
    serialize(endAt) {
      const entries = [
        `app;dur=${formatDuration(durationMs(startedAt, endAt))}`,
      ];
      for (const measurement of measurements) {
        entries.push(
          `${measurement.name};dur=${formatDuration(
            durationMs(measurement.startedAt, measurement.endedAt ?? endAt),
          )}`,
        );
      }
      return entries.join(', ');
    },
  };
}

function installResponseFinalizer(
  res: AxiomifyResponse,
  emit: () => void,
): void {
  let emitted = false;
  const beforeCommit = () => {
    if (emitted || res.headersSent) return;
    emitted = true;
    emit();
  };

  for (const method of ['send', 'sendRaw', 'stream'] as const) {
    const original = res[method];
    if (typeof original !== 'function') continue;
    Object.defineProperty(res, method, {
      configurable: true,
      value: function instrumentedResponseMethod(
        this: AxiomifyResponse,
        ...args: unknown[]
      ) {
        beforeCommit();
        return (original as (...values: unknown[]) => unknown).apply(
          this,
          args,
        );
      },
    });
  }
}

/**
 * Adds lightweight trace propagation and browser-visible request timings.
 *
 * This does not initialize an OpenTelemetry SDK. Pair it with
 * `app.enableTracing()` when you want OTLP exporting as well.
 */
export function useObservability(
  app: Axiomify,
  options: ObservabilityOptions = {},
): void {
  const serverTiming = options.serverTiming ?? true;
  const traceContext = options.traceContext ?? true;
  const timingsStateKey = options.timingsStateKey ?? 'timings';
  const traceContextStateKey = options.traceContextStateKey ?? 'traceContext';

  app.addHook('onRequest', (req, res) => {
    if (traceContext) {
      const context: TraceContext = {
        traceparent: headerValue(req.headers, 'traceparent'),
        tracestate: headerValue(req.headers, 'tracestate'),
        baggage: headerValue(req.headers, 'baggage'),
      };
      if (Object.values(context).some((value) => value !== undefined)) {
        req.state.set(traceContextStateKey, Object.freeze(context));
      }
    }

    if (!serverTiming) return;
    const timing = createTimings(process.hrtime.bigint());
    req.state.set(timingsStateKey, timing.timings);
    installResponseFinalizer(res, () => {
      res.header('Server-Timing', timing.serialize(process.hrtime.bigint()));
    });
  });
}
