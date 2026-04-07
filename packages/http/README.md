# @axiomify/http

The official native Node.js HTTP adapter for the Axiomify framework. 

`@axiomify/http` provides a pure, zero-dependency bridge between Axiomify's high-performance Radix routing engine and the native Node.js `http` server. It is incredibly lightweight, making it the absolute best choice for edge computing, serverless functions, and hyper-minimalist microservices.

## ✨ Features

- **Zero Dependencies:** Built entirely on the native Node.js `http` module. No middleware bloat.
- **Edge-Ready:** Incredibly small bundle size, perfect for Vercel Edge, AWS Lambda, or Cloudflare Workers.
- **Stable Request Identity:** Generates and locks a stable UUID (or inherits `x-request-id`) once per request, guaranteeing deterministic trace correlation across complex plugin lifecycles.
- **Stable Object References:** Implements memory-safe proxying for `req.params` and `req.state` to ensure data persists perfectly across the asynchronous hook pipeline.
- **Native Zod Integration:** Fully supports Axiomify's core validation compilation and request mutations.

## 📦 Installation

Install the adapter alongside the Axiomify core and your validation library of choice (like Zod):

```bash
npm install @axiomify/http @axiomify/core zod
````

## 🚀 Quick Start

Integrating Axiomify natively requires no third-party server frameworks.

```typescript
import http from 'node:http';
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';
import { z } from 'zod';

// 1. Initialize the Axiomify Core Engine
const app = new Axiomify();

// 2. Register your Axiomify Routes
app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({
      email: z.string().email(),
      name: z.string().min(2)
    })
  },
  handler: async (req, res) => {
    // req.body is safely typed and validated by Zod
    const { email, name } = req.body;
    return res.status(201).send({ success: true, user: { email, name } });
  }
});

// 3. Mount Axiomify onto a Native Node.js Server
// The adapter safely processes raw Node.js IncomingMessage and ServerResponse streams
const server = http.createServer(HttpAdapter(app));

// 4. Start the Server
server.listen(3000, () => {
  console.log('🚀 Native HTTP Server listening on http://localhost:3000');
});
```

## 🧩 The Adapter Ecosystem

If your application outgrows the native HTTP module and requires a massive middleware ecosystem, you can swap adapters with zero changes to your business logic:

  - [`@axiomify/fastify`](https://www.npmjs.com/package/@axiomify/fastify) - For maximum throughput.
  - [`@axiomify/express`](https://www.npmjs.com/package/@axiomify/express) - For maximum middleware compatibility.
  - [`@axiomify/hapi`](https://www.npmjs.com/package/@axiomify/hapi) - For enterprise environments.

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
