# @axiomify/express

The official Express.js adapter for the Axiomify framework. 

`@axiomify/express` bridges the gap between the world's most popular Node.js web framework and Axiomify's high-performance Radix routing and validation engine. It allows you to utilize Express's massive middleware ecosystem while gaining the type-safety and lifecycle hooks of Axiomify.

## ✨ Features

- **Maximum Compatibility:** Seamlessly integrates with your existing Express applications and standard Express middleware (e.g., `helmet`, `cors`).
- **Stable Object References:** Implements memory-safe proxying for `req.params` and `req.state` to ensure stable references across the asynchronous lifecycle.
- **Native Zod Integration:** Fully supports Axiomify's core validation compilation and request mutations.
- **Zero-Friction Migration:** Incrementally migrate legacy Express routes to Axiomify without rewriting your entire server.

## 📦 Installation

Ensure you install the adapter alongside the Axiomify core, Express, and your validation library of choice (like Zod):

```bash
npm install @axiomify/express @axiomify/core express zod
````

## 🚀 Quick Start

Integrating Axiomify into an Express application takes just a few lines of code.

```typescript
import express from 'express';
import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';
import { z } from 'zod';

// 1. Initialize your standard Express app
const expressApp = express();

// (Optional) Add your favorite Express middleware
expressApp.use(express.json());

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
    const { email, name } = req.body;
    return res.status(201).send({ success: true, user: { email, name } });
  }
});

// 4. Mount Axiomify onto Express
// The adapter intercepts traffic and funnels it into the Axiomify engine
expressApp.use(ExpressAdapter(app));

// 5. Start the Server
expressApp.listen(3000, () => {
  console.log('🚀 Server listening on http://localhost:3000');
});
```

## 🧩 The Adapter Ecosystem

If you ever need to scale beyond Express, Axiomify's decoupled architecture allows you to swap adapters with zero changes to your business logic:

  - [`@axiomify/fastify`](https://www.npmjs.com/package/@axiomify/fastify) - For maximum throughput.
  - [`@axiomify/hapi`](https://www.npmjs.com/package/@axiomify/hapi) - For enterprise environments.
  - [`@axiomify/http`](https://www.npmjs.com/package/@axiomify/http) - For zero-dependency edge deployments.

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://www.google.com/search?q=https://github.com/OTopman/axiomify).

## 📄 License

MIT
