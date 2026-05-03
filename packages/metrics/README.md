# @axiomify/metrics

Prometheus-compatible metrics endpoint for Axiomify. Exports per-route request counts, latency, and optional WebSocket connection metrics.

## Install

```bash
npm install @axiomify/metrics
```

## Quick start

```typescript
import { useMetrics } from '@axiomify/metrics';

useMetrics(app, {
  path: '/metrics',  // default
});
```

Point your Prometheus scrape config at `http://localhost:3000/metrics`.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | `'/metrics'` | Endpoint path for the metrics export. |
| `protect` | `(req) => boolean \| Promise<boolean>` | — | Return `false` to reject with 403. |
| `requireToken` | `string` | — | Require `X-Metrics-Token` header to match this value. |
| `allowlist` | `string[]` | — | Allow only these IPv4 addresses or CIDR ranges. |
| `wsManager` | `{ getStats(): { connectedClients: number; rooms: Record<string, number> } }` | — | Pass `getWsManager(app)` to include WebSocket metrics. |

If none of `protect`, `requireToken`, or `allowlist` are set, a startup warning is emitted:
```
[axiomify/metrics] Warning: /metrics is publicly accessible. Set protect, requireToken, or allowlist.
```

## Securing the endpoint

```typescript
// Token-based
useMetrics(app, {
  requireToken: process.env.METRICS_TOKEN,
});

// IP allowlist
useMetrics(app, {
  allowlist: ['127.0.0.1', '10.0.0.0/8', '192.168.0.0/16'],
});

// Custom logic
useMetrics(app, {
  protect: (req) => {
    return req.headers['x-internal-token'] === process.env.METRICS_TOKEN;
  },
});
```

## Exported metrics

```
# HELP axiomify_requests_total Total number of handled requests by route and status
# TYPE axiomify_requests_total counter
axiomify_requests_total{method="GET",route="/users/:id",status="200"} 1432
axiomify_requests_total{method="POST",route="/users",status="201"} 87
axiomify_requests_total{method="POST",route="/users",status="400"} 12

# HELP axiomify_request_duration_ms_total Cumulative request duration in ms by route
# TYPE axiomify_request_duration_ms_total counter
axiomify_request_duration_ms_total{method="GET",route="/users/:id"} 14320.5

# HELP axiomify_process_uptime_seconds Process uptime in seconds
# TYPE axiomify_process_uptime_seconds gauge
axiomify_process_uptime_seconds 3600.2
```

**Cardinality is bounded** — labels use matched route patterns (`/users/:id`), never concrete URLs (`/users/42`). This prevents label explosion from path parameters.

## WebSocket metrics

```typescript
import { getWsManager, useWebSockets } from '@axiomify/ws';
import { useMetrics } from '@axiomify/metrics';

useWebSockets(app, { server, path: '/ws' });
useMetrics(app, {
  wsManager: getWsManager(app),
});
```

Adds:
```
axiomify_ws_connected_clients 247
axiomify_ws_rooms{room="chat-general"} 88
```

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: 'axiomify-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    bearer_token: 'your-metrics-token'
```
