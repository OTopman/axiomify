# @axiomify/serverless

Platform-independent serverless and edge adapter for Axiomify using standard Fetch API `Request` and `Response` objects.

## Install

```bash
npm install @axiomify/serverless @axiomify/core zod
```

Runs on Node.js ≥ 20. Compatible with WinterCG-compliant edge runtimes (Cloudflare Workers, Vercel Edge Runtime, Bun, Deno, etc.) that support standard web globals and Node.js compatibility layers.

## API

- `new ServerlessAdapter(app)` — create the adapter wrapping an `Axiomify` instance.
- `adapter.handle(request: Request): Promise<Response>` — handle a Web standard `Request` object and return a standard `Response` object.

## Usage

### Cloudflare Workers / Vercel Edge

```typescript
import { Axiomify } from '@axiomify/core';
import { ServerlessAdapter } from '@axiomify/serverless';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/user/:id',
  schema: {
    params: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), active: z.boolean() }),
  },
  handler: async (req, res) => {
    res.send({ id: req.params.id, active: true });
  },
});

const adapter = new ServerlessAdapter(app);

// Export standard fetch handler
export default {
  async fetch(request: Request): Promise<Response> {
    return adapter.handle(request);
  },
};
```

### AWS Lambda

You can deploy Axiomify to AWS Lambda using Lambda Function URLs or API Gateway by mapping the event to a standard Fetch `Request` and returning the response, or by using a community wrapper library.

## Response Streaming

`@axiomify/serverless` supports chunked transfer/streaming responses out of the box using `res.stream(nodeReadable)` by converting it into a Web API `ReadableStream` under the hood.

```typescript
app.route({
  method: 'GET',
  path: '/stream-logs',
  handler: async (req, res) => {
    const readable = getLogStream(); // Node.js Readable stream
    res.stream(readable, 'text/plain');
  },
});
```

## Browser Compatibility

This package (and `@axiomify/core`) depends on server-side capabilities (such as `node:async_hooks` for trace telemetry and `stream` for payload buffering). It **cannot** run inside client-side browsers.
