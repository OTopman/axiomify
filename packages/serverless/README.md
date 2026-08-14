# @axiomify/serverless

[![npm version](https://img.shields.io/npm/v/@axiomify/serverless.svg)](https://npmjs.com/package/@axiomify/serverless)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Node-compatible serverless adapter for Axiomify using standard Fetch API
`Request` and `Response` objects at its boundary.

Runs on Node.js serverless platforms and edge runtimes that provide the Node
compatibility APIs required by Axiomify (`node:async_hooks`, `node:crypto`,
`node:path`, and `node:stream`). Cloudflare Workers, Vercel Edge, Bun, and Deno
must have an appropriate Node compatibility mode; generic WinterCG support is
not currently provided.

## Install

```bash
npm install @axiomify/serverless @axiomify/core zod
```

## Quick Example (Fetch handler with Node compatibility)

```typescript
import { Axiomify } from '@axiomify/core';
import { ServerlessAdapter } from '@axiomify/serverless';
import { z } from 'zod';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/hello/:name',
  schema: {
    params: z.object({ name: z.string() }),
    response: z.object({ message: z.string() }),
  },
  handler: async (req, res) => {
    res.send({ message: `Hello, ${req.params.name}!` });
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

## Options — `new ServerlessAdapter(app, options?)`

| Option        | Default           | Description                                                                                                                                                                                             |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxBodySize` | `1048576` (1 MiB) | Maximum request body size in bytes. Requests exceeding this are rejected with `413 Payload Too Large` before parsing (checked against `Content-Length`, then re-checked against the actual bytes read). |
| `trustProxy`  | `false`           | When `true`, derive the client IP from the `X-Forwarded-For` header. Only enable behind a trusted proxy — the header is client-spoofable. When `false`, `req.ip` is left empty.                         |

```typescript
const adapter = new ServerlessAdapter(app, {
  maxBodySize: 5 * 1024 * 1024, // 5 MiB
  trustProxy: true,
});
```

The request id is taken from the `X-Request-Id` header when present, otherwise generated with `crypto.randomUUID()`.

## Server-Sent Events

`res.sseInit()` and `res.sseSend()` are supported and return a standard
streaming Fetch `Response`. The connection stays open until the client
disconnects or cancels the response stream.

```typescript
app.route({
  method: 'GET',
  path: '/events',
  handler: (_req, res) => {
    res.sseInit(15_000);
    res.sseSend({ ready: true }, 'status');
  },
});
```

## AWS Lambda / Vercel Integration

To run on platforms expecting standard Lambda handlers, you can wrap the fetch adapter using community adapter libraries (e.g. `@parse/lambda`, `@edge-runtime/primitives`, or basic mapping).

## Browser Compatibility Warning

This package (and `@axiomify/core`) depends on Node-compatible background APIs (like `node:async_hooks` and `node:path`). It is **not** designed to run inside client-side browsers.

## License

MIT
