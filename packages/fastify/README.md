# @axiomify/fastify

The official Fastify adapter for the Axiomify framework. 

`@axiomify/fastify` combines the industry-leading throughput of Fastify with Axiomify's high-performance Radix routing, validation engine, and memory-safe plugin ecosystem. It is designed for applications that require maximum requests-per-second (RPS) and low-latency responses.

## ✨ Features

- **Maximum Throughput:** Leverages Fastify's highly optimized core to handle massive traffic spikes with minimal overhead.
- **Native Streaming Support:** Automatically configured to bypass Fastify's strict media parsers for `multipart/form-data`, ensuring seamless integration with `@axiomify/upload` for RAM-safe file streaming.
- **Stable Object References:** Implements memory-safe proxying for `req.params` and `req.state` to ensure stable references across complex asynchronous hook lifecycles.
- **Native Zod Integration:** Fully supports Axiomify's core validation compilation and request mutations without triggering getter-lock exceptions.

## 📦 Installation

Ensure you install the adapter alongside the Axiomify core, Fastify, and your validation library of choice (like Zod):

```bash
npm install @axiomify/fastify @axiomify/core fastify zod
````

## 🚀 Quick Start

Integrating Axiomify into a Fastify application provides instant type-safety and lifecycle management.

```typescript
import Fastify from 'fastify';
import { Axiomify } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';
import { z } from 'zod';

// 1. Initialize your standard Fastify app
const fastifyApp = Fastify({ logger: true });

// 2. Initialize the Axiomify Core Engine
const app = new Axiomify();

// 3. Register your Axiomify Routes
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

// 4. Mount Axiomify onto Fastify
// The adapter intercepts traffic, safely handles content parsers, 
// and funnels requests into the Axiomify engine.
fastifyApp.register(FastifyAdapter(app));

// 5. Start the Server
fastifyApp.listen({ port: 3000 }, (err, address) => {
  if (err) throw err;
  console.log(`🚀 Server listening on ${address}`);
});
```

## 🧩 The Adapter Ecosystem

If your deployment targets change, Axiomify's decoupled architecture allows you to swap adapters with zero changes to your business logic:

  - [`@axiomify/express`](https://www.npmjs.com/package/@axiomify/express) - For maximum middleware compatibility.
  - [`@axiomify/hapi`](https://www.npmjs.com/package/@axiomify/hapi) - For enterprise environments.
  - [`@axiomify/http`](https://www.npmjs.com/package/@axiomify/http) - For zero-dependency edge deployments.

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
