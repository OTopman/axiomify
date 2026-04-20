import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

export interface MetricsOptions {
  path?: string;
  protect?: (req: AxiomifyRequest) => boolean | Promise<boolean>;
  wsManager?: any;
}

/**
 * Prometheus requires label values to have low, bounded cardinality. Using
 * the concrete request path (`/users/123`, `/users/124`, …) as a label would
 * create a distinct time-series per URL, leading to OOM under traffic. The
 * matched route's *pattern* (`/users/:id`) is the correct, bounded value.
 */
export function useMetrics(app: Axiomify, options: MetricsOptions = {}): void {
  const metricsPath = options.path ?? '/metrics';

  const stats = {
    requestsTotal: new Map<string, number>(),
    durationTotal: new Map<string, number>(),
  };

  // Start our own timer. Previously metrics depended on @axiomify/logger
  // setting `req.state.startTime`; loaded alone, metrics silently reported
  // `durationMs = 0` on every request.
  app.addHook('onRequest', (req: AxiomifyRequest) => {
    if (req.state.startTime === undefined) {
      req.state.startTime = process.hrtime.bigint();
    }
  });

  app.addHook(
    'onPostHandler',
    (req: AxiomifyRequest, res: AxiomifyResponse, match: any) => {
      if (req.path === metricsPath) return;

      // Prefer the matched route pattern for cardinality control; fall back
      // to the concrete path only if no match is available (edge cases:
      // hooks that fire with `match == null`).
      const routeLabel: string = match?.route?.path ?? req.path;

      const status = res.headersSent ? (res as any).statusCode || 200 : 500;
      const label = `method="${req.method}",route="${routeLabel}",status="${
        status === 0 ? 'unknown' : status
      }"`;

      const durationMs = req.state.startTime
        ? Number(process.hrtime.bigint() - req.state.startTime) / 1_000_000
        : 0;

      stats.requestsTotal.set(label, (stats.requestsTotal.get(label) || 0) + 1);
      stats.durationTotal.set(
        label,
        (stats.durationTotal.get(label) || 0) + durationMs,
      );
    },
  );

  app.route({
    method: 'GET',
    path: metricsPath,
    handler: async (req, res) => {
      if (options.protect) {
        const isAllowed = await options.protect(req);
        if (!isAllowed) {
          return res.status(403).send(null, 'Forbidden');
        }
      }

      let output =
        '# HELP http_requests_total Total number of HTTP requests.\n';
      output += '# TYPE http_requests_total counter\n';
      for (const [label, count] of stats.requestsTotal.entries()) {
        output += `http_requests_total{${label}} ${count}\n`;
      }

      output +=
        '\n# HELP http_request_duration_ms Total duration of HTTP requests in milliseconds.\n';
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

      // Explicitly flag headersSent for the mock-based test suite. The
      // adapter-backed res.sendRaw sets it for real.
      (res as any).headersSent = true;
      res.sendRaw(output, 'text/plain; version=0.0.4');
    },
  });
}
