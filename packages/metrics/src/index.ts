import type {
  Axiomify,
  AxiomifyRequest,
  AxiomifyResponse,
} from '@axiomify/core';
import { timingSafeEqual } from 'crypto';

export interface MetricsOptions {
  path?: string;
  protect?: (req: AxiomifyRequest) => boolean | Promise<boolean>;
  wsManager?: any;
  allowlist?: string[];
  requireToken?: string;
  /**
   * Explicitly allow public metrics in production. Defaults to false.
   */
  allowPublicInProduction?: boolean;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

type IpMatcher = (ip: string) => boolean;

function buildAllowlistMatchers(allowlist: string[]): IpMatcher[] {
  return allowlist.flatMap((entry) => {
    if (!entry.includes('/')) {
      return [(ip: string) => ip === entry];
    }

    const [cidrIp, bitsRaw] = entry.split('/');
    const bits = Number(bitsRaw);
    const cidrInt = ipv4ToInt(cidrIp);
    if (cidrInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      return [];
    }

    const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1) >>> 0;
    return [
      (ip: string) => {
        const ipInt = ipv4ToInt(ip);
        return ipInt !== null && (ipInt & mask) === (cidrInt & mask);
      },
    ];
  });
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

export function useMetrics(app: Axiomify, options: MetricsOptions = {}): void {
  const metricsPath = options.path ?? '/metrics';
  let emittedPublicMetricsWarning = false;

  if (!options.protect && !options.allowlist && !options.requireToken) {
    console.warn(
      '[axiomify/metrics] Warning: /metrics is publicly accessible. Set protect, allowlist, or requireToken in production.',
    );
  }

  const allowlistMatchers = options.allowlist
    ? buildAllowlistMatchers(options.allowlist)
    : null;

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
    'onPreHandler',
    (req: AxiomifyRequest, _res: AxiomifyResponse, match: any) => {
      if (match?.route?.path) {
        req.state.metricsRouteLabel = String(match.route.path);
      }
    },
  );

  app.addHook(
    'onPostHandler',
    (req: AxiomifyRequest, res: AxiomifyResponse, match: any) => {
      const routeLabel: string =
        match?.route?.path ??
        (req.state.metricsRouteLabel as string | undefined) ??
        UNMATCHED_ROUTE_LABEL;
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
    const routeLabel =
      (req.state.metricsRouteLabel as string | undefined) ??
      UNMATCHED_ROUTE_LABEL;
    record(req, status, routeLabel);
  });

  app.route({
    method: 'GET',
    path: metricsPath,
    handler: async (req, res) => {
      if (options.requireToken) {
        const token = req.headers['x-metrics-token'];
        const supplied = Array.isArray(token) ? token[0] : token;
        if (!tokenMatches(supplied, options.requireToken)) {
          return res.status(403).send(null, 'Forbidden');
        }
      }

      if (allowlistMatchers) {
        const ip = req.ip ?? '';
        if (!allowlistMatchers.some((match) => match(ip)))
          return res.status(403).send(null, 'Forbidden');
      }

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
  const UNMATCHED_ROUTE_LABEL = '__unmatched__';
  const tokenMatches = (supplied: string | undefined, expected: string) => {
    if (typeof supplied !== 'string') return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };
