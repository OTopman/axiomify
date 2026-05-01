# @axiomify/metrics

Prometheus-style metrics endpoint for Axiomify.

## Install

```bash
npm i @axiomify/metrics
```

## Usage

```ts
import { useMetrics } from '@axiomify/metrics';

useMetrics(app, {
  path: '/metrics',
  requireToken: process.env.METRICS_TOKEN,
  // or: allowlist: ['127.0.0.1', '10.0.0.0/8']
});
```

## Security

You can protect metrics using:

- `protect(req)` custom callback,
- `requireToken` header check (`x-metrics-token`),
- `allowlist` of exact IPv4 addresses and/or IPv4 CIDR ranges.

If none are set, a startup warning is emitted:

`[axiomify/metrics] Warning: /metrics is publicly accessible...`
