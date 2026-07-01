# @axiomify/metrics

[![npm version](https://img.shields.io/npm/v/@axiomify/metrics.svg)](https://npmjs.com/package/@axiomify/metrics)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Prometheus-compatible metrics endpoint for Axiomify. Exports per-route request counts, latency, and optional WebSocket connection metrics.

## Install

```bash
npm install @axiomify/metrics
```

## Quick start

```typescript
import { useMetrics } from '@axiomify/metrics';

useMetrics(app, {
  path: '/metrics', // default
});
```

Point your Prometheus scrape config at `http://localhost:3000/metrics`.

## Options

| Option                    | Type                                   | Default      | Description                                                                             |
| ------------------------- | -------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `path`                    | `string`                               | `'/metrics'` | Endpoint path for the metrics export.                                                   |
| `protect`                 | `(req) => boolean \| Promise<boolean>` | —            | Return `false` to reject with 403.                                                      |
| `requireToken`            | `string`                               | —            | Require `X-Metrics-Token` header to match this value (compared in constant time).       |
| `allowlist`               | `string[]`                             | —            | Allow only these IPv4 addresses or CIDR ranges.                                         |
| `wsManager`               | `{ getStats(): {...} }`                | —            | Optional WebSocket manager. When set, WebSocket connection/room metrics are exported.   |
| `allowPublicInProduction` | `boolean`                              | `false`      | When `NODE_ENV === 'production'` and no `protect` is set, allow unauthenticated access.  |

If none of `protect`, `requireToken`, or `allowlist` are set, a startup warning is emitted:

```
[axiomify/metrics] Warning: /metrics is publicly accessible. Set protect, allowlist, or requireToken in production.
```

### Production hardening

In production (`NODE_ENV === 'production'`), if no `protect` function is set the endpoint is **denied by default** (403) unless you opt in with `allowPublicInProduction: true`. Note this default-deny path applies only to the `protect` check; `requireToken` and `allowlist` are enforced independently regardless of environment. Token comparison uses `crypto.timingSafeEqual` to avoid leaking the token via timing.

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
# HELP http_requests_total Total number of HTTP requests.
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/users/:id",status="200"} 1432
http_requests_total{method="POST",route="/users",status="201"} 87
http_requests_total{method="POST",route="/users",status="400"} 12

# HELP http_request_duration_ms Total duration of HTTP requests in ms.
# TYPE http_request_duration_ms counter
http_request_duration_ms{method="GET",route="/users/:id"} 14320.500
```

**Cardinality is bounded** — labels use matched route patterns (`/users/:id`), never concrete URLs (`/users/42`). This prevents label explosion from path parameters. Requests that never match a route are labelled `__unmatched__`, and requests to the metrics endpoint itself are not counted.

### WebSocket metrics

When a `wsManager` is provided, additional series are appended:

```
# HELP ws_connected_clients WebSocket clients
# TYPE ws_connected_clients gauge
ws_connected_clients 42

# HELP ws_messages_received_total Total WebSocket messages received
# TYPE ws_messages_received_total counter
ws_messages_received_total 1200

# HELP ws_messages_sent_total Total WebSocket messages sent
# TYPE ws_messages_sent_total counter
ws_messages_sent_total 980

# HELP ws_room_clients WebSocket room client count
# TYPE ws_room_clients gauge
ws_room_clients{room="lobby"} 12
```

`ws_messages_received_total` and `ws_messages_sent_total` are emitted only when the manager's stats include those fields.

## Prometheus scrape config

When using `requireToken`, the token is read from the `X-Metrics-Token` request header, so configure it via `authorization` is not applicable — pass it as a custom header:

```yaml
scrape_configs:
  - job_name: 'axiomify-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    headers:
      X-Metrics-Token: 'your-metrics-token'
```
