import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';

export interface MetricsOptions {
  path?: string; // Default: '/metrics'
}

export function useMetrics(app: Axiomify, options: MetricsOptions = {}): void {
  const metricsPath = options.path ?? '/metrics';

  // In-memory Prometheus registry
  const stats = {
    requestsTotal: new Map<string, number>(),
    durationTotal: new Map<string, number>(),
  };

  // 1. Hook into the lifecycle to record data
  app.addHook(
    'onPostHandler',
    (req: AxiomifyRequest, res: AxiomifyResponse) => {
      if (req.path === metricsPath) return; // Don't track the metrics endpoint itself

      // In a real adapter, you'd extract the captured status code from res.raw or the translator state.
      // For this generic plugin, we'll assume successful if no error was thrown, defaulting to 200/500 for simplicity.
      const status = res.headersSent ? (res as any).statusCode || 200 : 500;
      const label = `method="${req.method}",route="${req.path}",status="${status}"`;

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

  // 2. Expose the Prometheus-formatted endpoint
  app.route({
    method: 'GET',
    path: metricsPath,
    handler: async (req, res) => {
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

      res.sendRaw(output, 'text/plain; version=0.0.4');
    },
  });
}
