# Validate incoming webhook signatures

Verify a provider's signature against the exact raw request bytes before
processing or queueing a webhook event.

## When to use this

Use this pattern for signed callbacks from payment, source-control, or identity
providers. The example uses an HMAC-SHA256 signature in a `sha256=<hex>` header;
adapt the header and canonicalization rules to the provider's published spec.

## Prerequisites

```bash
npm install @axiomify/core @axiomify/native @axiomify/helmet zod
```

Set `WEBHOOK_SECRET` to a high-entropy secret from your secret manager.

## Implementation

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { z } from 'zod';

const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error('WEBHOOK_SECRET is required');

const app = new Axiomify();
const eventSchema = z.object({ id: z.string(), type: z.string() });

app.route({
  method: 'POST',
  path: '/webhooks/provider',
  schema: { body: eventSchema, response: z.object({ accepted: z.boolean() }) },
  handler: async (req, res) => {
    const signature = req.headers['x-provider-signature'];
    if (
      typeof signature !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/i.test(signature)
    ) {
      return res.status(401).send({ accepted: false });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req.stream) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const expected = createHmac('sha256', secret).update(raw).digest();
    const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return res.status(401).send({ accepted: false });
    }

    const event = eventSchema.parse(req.body);
    await enqueueWebhook(event); // durable enqueue; return quickly to provider
    return res.status(202).send({ accepted: true });
  },
});

new NativeAdapter(app, { port: Number(process.env.PORT ?? 3000) }).listen();
```

## Production notes

- Confirm that the selected adapter exposes the original request bytes as
  `req.rawBody`; signature verification must happen before parsing or
  re-serializing JSON.
- Use each provider's timestamp/replay-window and rotation rules where
  available. Deduplicate event IDs in durable storage.
- Keep the handler idempotent and enqueue before acknowledging delivery.
- Apply a body-size limit and rate limit at the adapter or network boundary.

## Verification

Add tests for a valid signature, a wrong signature, malformed header values,
and repeated event IDs. Use the provider's published signature vectors when
available.
