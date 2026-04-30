import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

export interface MetricsOptions {
  path?: string;
  protect?: (req: AxiomifyRequest) => boolean | Promise<boolean>;
  wsManager?: any;
  /**
   * Explicitly allow public metrics in production. Defaults to false.
   */
  allowPublicInProduction?: boolean;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function useMetrics(app: Axiomify, options: MetricsOptions = {}): void {
  const metricsPath = options.path ?? '/metrics';
  let emittedPublicMetricsWarning = false;

  if (!options.protect && process.env.NODE_ENV === 'production') {
    console.warn(
      '[axiomify/metrics] The metrics endpoint is not protected. ' +
        'Production access is denied by default. Provide a `protect` function ' +
        'or set `allowPublicInProduction: true` explicitly.',
    );
  }

  const stats = {
    requestsTotal: new Map<string, number>(),
    durationTotal: new Map<string, number>(),
  };

  const record = (
    req: AxiomifyRequest,
    status: number | string,
    routeLabel: string,
  ) => {
    if (req.path === metricsPath) return;

    const label =
      `method="${escapeLabelValue(req.method)}",` +
      `route="${escapeLabelValue(routeLabel)}",` +
      `status="${escapeLabelValue(String(status))}"`;

    const durationMs = req.state.startTime
      ? Number(process.hrtime.bigint() - req.state.startTime) / 1_000_000
      : 0;

    stats.requestsTotal.set(label, (stats.requestsTotal.get(label) ?? 0) + 1);
    stats.durationTotal.set(
      label,
      (stats.durationTotal.get(label) ?? 0) + durationMs,
    );
  };

  app.addHook('onRequest', (req: AxiomifyRequest) => {
    if (req.state.startTime === undefined) {
      req.state.startTime = process.hrtime.bigint();
    }
  });

  app.addHook(
    'onPostHandler',
    (req: AxiomifyRequest, res: AxiomifyResponse, match: any) => {
      const routeLabel: string = match?.route?.path ?? req.path;
      const status = res.statusCode || 200;
      record(req, status, routeLabel);
    },
  );

  app.addHook('onError', (err: any, req: AxiomifyRequest) => {
    const status =
      typeof err?.statusCode === 'number'
        ? err.statusCode
        : typeof err?.status === 'number'
          ? err.status
          : 500;
    record(req, status, req.path);
  });

  app.route({
    method: 'GET',
    path: metricsPath,
    handler: async (req, res) => {
      if (options.protect) {
        const isAllowed = await options.protect(req);
        if (!isAllowed) {
          return res.status(403).send(null, 'Forbidden');
        }
      } else if (
        process.env.NODE_ENV === 'production' &&
        !options.allowPublicInProduction
      ) {
        if (!emittedPublicMetricsWarning) {
          emittedPublicMetricsWarning = true;
          console.warn(
            '[axiomify/metrics] Denied public metrics request in production.',
          );
        }
        return res.status(403).send(null, 'Forbidden');
      }

      let output =
        '# HELP http_requests_total Total number of HTTP requests.\n';
      output += '# TYPE http_requests_total counter\n';
      for (const [label, count] of stats.requestsTotal.entries()) {
        output += `http_requests_total{${label}} ${count}\n`;
      }

      output +=
        '\n# HELP http_request_duration_ms Total duration of HTTP requests in ms.\n';
      output += '# TYPE http_request_duration_ms counter\n';
      for (const [label, duration] of stats.durationTotal.entries()) {
        output += `http_request_duration_ms{${label}} ${duration.toFixed(3)}\n`;
      }

      if (options.wsManager) {
        const wsStats = options.wsManager.getStats();
        output += '\n# HELP ws_connected_clients WebSocket clients\n';
        output += '# TYPE ws_connected_clients gauge\n';
        output += `ws_connected_clients ${wsStats.connectedClients}\n`;
      }

      // Do NOT mutate res.headersSent — sendRaw handles response state.
      res.sendRaw(output, 'text/plain; version=0.0.4');
    },
  });
}
