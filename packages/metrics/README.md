# @axiomify/metrics

Prometheus-compatible observability with automatic request latency tracking, per-route metrics, and a live HTML dashboard.

## Installation

```bash
npm install @axiomify/metrics
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { useMetrics } from '@axiomify/metrics';

const app = new Axiomify();

// Enable metrics collection
useMetrics(app);

// Metrics are automatically exported at /metrics (Prometheus format)
// Live dashboard at /metrics/dashboard
```

## Features

- **Zero-Config**: Automatically collects request latency, status codes, and route patterns
- **Prometheus Compatible**: Export metrics in standard Prometheus format for Grafana, Datadog, etc.
- **Live Dashboard**: Built-in HTML dashboard at `/metrics/dashboard` — no external tools needed
- **Cardinality Safe**: Uses route *patterns* (e.g., `/users/:id`), not concrete URLs, to prevent cardinality explosion
- **High-Performance**: Minimal overhead in the request path

## API Reference

### `useMetrics(app, options?)`

Registers metrics collection on the app.

**Options:**

```typescript
interface MetricsOptions {
  // Custom label extraction (e.g., for tenants, API versions)
  labels?: (req: AxiomifyRequest) => Record<string, string>;
  
  // Endpoint to export metrics (default: /metrics)
  metricsPath?: string;
  
  // Endpoint for live dashboard (default: /metrics/dashboard)
  dashboardPath?: string;
  
  // Buckets for latency histogram (in milliseconds)
  latencyBuckets?: number[]; // default: [10, 50, 100, 500, 1000, 5000]
}
```

## Exported Metrics

The `/metrics` endpoint exports these Prometheus metrics:

```
# HELP http_request_duration_ms Request duration in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{route="/api/users/:id",method="GET",status="200",le="10"}
http_request_duration_ms_bucket{route="/api/users/:id",method="GET",status="200",le="50"}
http_request_duration_ms_bucket{route="/api/users/:id",method="GET",status="200",le="100"}
...

# HELP http_request_total Total number of HTTP requests
# TYPE http_request_total counter
http_request_total{route="/api/users/:id",method="GET",status="200"}
```

## Dashboard

Visit `http://localhost:3000/metrics/dashboard` to see:

- **Request Rate**: Requests per second, per route
- **Latency Histogram**: P50, P95, P99 latencies
- **Error Rate**: 5xx responses per route
- **Live Charts**: Auto-updating graphs (refresh every 5 seconds)

No authentication by default — add your own middleware if needed:

```typescript
const requireAuth = createAuthPlugin({ secret: process.env.JWT_SECRET! });

app.route({
  method: 'GET',
  path: '/metrics/dashboard',
  plugins: [requireAuth], // Protect dashboard with auth
  handler: async (req, res) => {
    // Default handler served by useMetrics
  },
});
```

## Examples

### Basic Setup

```typescript
useMetrics(app);
// Metrics at /metrics, dashboard at /metrics/dashboard
```

### Custom Buckets for Faster APIs

```typescript
useMetrics(app, {
  latencyBuckets: [1, 5, 10, 25, 50, 100, 250, 500],
});
// Optimized for APIs with sub-100ms latency
```

### Add Tenant/Customer Labels

```typescript
useMetrics(app, {
  labels: (req) => ({
    tenant: req.user?.tenantId || 'unknown',
    apiVersion: req.headers['x-api-version'] || 'v1',
  }),
});

// Exported metric:
// http_request_total{route="/api/users",method="GET",status="200",tenant="acme",apiVersion="v1"}
```

### Custom Metrics Endpoint

```typescript
useMetrics(app, {
  metricsPath: '/internal/prometheus',
  dashboardPath: '/internal/metrics',
});
```

## Integration with Prometheus

Add Axiomify as a scrape target in your `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'axiomify-app'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

Then query metrics in Grafana:

```promql
# Request rate (requests per second)
rate(http_request_total[5m])

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))

# Error rate
sum(rate(http_request_total{status=~"5.."}[5m]))
```

## Integration with DataDog

```typescript
// Use a DataDog-compatible exporter
import { registerExporter } from '@datadog/browser-rum';

useMetrics(app, {
  // Metrics are exported in Prometheus format at /metrics
  // Use DataDog's Prometheus integration to scrape them
});
```

Then in DataDog:
```
Integrations → Prometheus → Add a check for http://localhost:3000/metrics
```

## Integration with Google Cloud Monitoring

CloudRun and CloudFunction support standard Prometheus metrics:

1. Deploy Axiomify app to CloudRun
2. In Cloud Console, go to Monitoring → Dashboards
3. Add a chart that queries `/metrics` via the CloudRun health check endpoint

## Cardinality Safety

The metrics plugin uses *route patterns* (e.g., `/api/users/:id`) as labels, never concrete URLs. This prevents cardinality explosion:

```typescript
// ❌ BAD: Cardinality explosion
http_request_total{path="/api/users/1"}     // user 1
http_request_total{path="/api/users/2"}     // user 2
http_request_total{path="/api/users/99999"} // user 99999
// Total: thousands of metrics!

// ✅ GOOD: Bounded cardinality
http_request_total{route="/api/users/:id"} // All users
// Total: 1 metric per route
```

## Testing

```typescript
it('exports metrics in Prometheus format', async () => {
  const res = await fetch('http://localhost:3000/metrics');
  const text = await res.text();
  
  expect(text).toContain('http_request_duration_ms_bucket');
  expect(text).toContain('http_request_total');
});

it('tracks latency histogram', async () => {
  const res = await fetch('http://localhost:3000/metrics');
  const text = await res.text();
  
  expect(text).toContain('http_request_duration_ms_bucket{route="/api/users",method="GET"');
});

it('tracks request count', async () => {
  await fetch('http://localhost:3000/api/users');
  
  const res = await fetch('http://localhost:3000/metrics');
  const text = await res.text();
  
  expect(text).toContain('http_request_total{route="/api/users",method="GET",status="200"} ');
});
```

## Performance Impact

Metrics collection is designed to be lightweight:

- **Histogram recording**: ~0.1ms per request
- **Cardinality**: Bounded by number of routes × methods, not request volume
- **Memory**: ~1MB for 100 routes with full histogram data

Dashboard updates via polling (every 5 seconds) — zero-overhead server-sent events.

## License

MIT
