# @axiomify/metrics

Prometheus-style metrics export for Axiomify.

## Install

```bash
npm install @axiomify/metrics
```

## Export

- `useMetrics(app, options?)`

## Options

- `path`
- `protect`
- `wsManager`

## Example

```ts
useMetrics(app, {
  path: '/metrics',
  protect: async (req) => req.headers['x-internal-key'] === process.env.METRICS_KEY,
});
```

## Behavior

- exports request counts and cumulative duration
- uses the matched route pattern as the metric label to avoid cardinality explosion
- can include WebSocket connection stats when `wsManager` is provided
