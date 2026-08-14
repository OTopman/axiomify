# Request-to-job trace continuity

Keep a request’s W3C trace context and timing visible when the request queues
background work.

## Prerequisites

```bash
npm install @axiomify/core @axiomify/jobs @axiomify/observability
```

## Implementation

`@axiomify/observability` makes inbound `traceparent`, `tracestate`, and
`baggage` available as `req.state.traceContext`. The jobs scheduler propagates
the active OpenTelemetry context when an SDK is enabled, so enable tracing in
deployments that export OTLP data.

```ts
import { Axiomify } from '@axiomify/core';
import { jobsModule } from '@axiomify/jobs';
import { useObservability } from '@axiomify/observability';

const app = new Axiomify();
useObservability(app);
app.enableTracing(); // requires the optional OpenTelemetry packages
app.use(jobsModule({ queue: 'email', storage: 'sql' }));

app.route({
  method: 'POST',
  path: '/invitations',
  handler: async (req, res) => {
    const db = req.state.timings.start('db');
    const invitation = await invitations.create(req.body);
    db.end();

    await app.resolve('jobs').enqueue('send-invitation', {
      invitationId: invitation.id,
    });
    res.status(202).send({ id: invitation.id });
  },
});
```

## Production notes

- Use persistent jobs storage; in-memory queues do not survive restarts or
  work across clustered processes.
- Do not put credentials, addresses, or request bodies in trace attributes.
- Configure OTLP endpoints and service names through the standard `OTEL_*`
  environment variables.

## Verification

Send a request with a `traceparent` header, then inspect the trace backend for
the HTTP span and the queued job’s child span. Browser developer tools should
also show `Server-Timing` on the HTTP response.
