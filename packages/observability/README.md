# @axiomify/observability

Zero-dependency request observability for Axiomify. It exposes incoming W3C
trace context and adds the browser-native `Server-Timing` response header.

```ts
import { useObservability } from '@axiomify/observability';

useObservability(app);

app.route({
  method: 'GET',
  path: '/orders/:id',
  handler: async (req, res) => {
    // { traceparent?, tracestate?, baggage? }
    console.log(req.state.traceContext);

    const db = req.state.timings.start('db');
    const order = await dbClient.orders.find(req.params.id);
    db.end();

    res.send(order);
  },
});
```

Responses include a header such as `Server-Timing: app;dur=8.2, db;dur=5.1`.
Use it with `app.enableTracing()` when you also want OpenTelemetry export.
