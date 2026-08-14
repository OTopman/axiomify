# @axiomify/observability

```bash
npm install @axiomify/observability
```

This package provides zero-dependency request instrumentation. It extracts W3C
trace propagation headers into request state and emits the standard
`Server-Timing` response header before a response commits.

```ts
import { useObservability } from '@axiomify/observability';

useObservability(app);

app.route({
  method: 'GET',
  path: '/products/:id',
  handler: async (req, res) => {
    const db = req.state.timings.start('db');
    const product = await products.find(req.params.id);
    db.end();
    res.send(product);
  },
});
```

`req.state.traceContext` contains any incoming `traceparent`, `tracestate`,
and `baggage` headers. `req.state.timings.start(name)` returns an `.end()`
handle; unclosed timings end when the response is committed. The response above
includes a header similar to `Server-Timing: app;dur=8.2, db;dur=5.1`.

Set `{ serverTiming: false }` or `{ traceContext: false }` to disable either
capability. This package does not initialize an OpenTelemetry SDK; pair it with
`app.enableTracing()` when you need OTLP export.
