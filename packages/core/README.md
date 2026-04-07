# @axiomify/core

The high-performance, zero-dependency routing engine, lifecycle hook manager, and validation compiler at the heart of the Axiomify framework. 

`@axiomify/core` is completely framework-agnostic. It processes HTTP abstractions and can be attached to any Node.js server environment (Express, Fastify, Hapi, or native HTTP) via its adapter ecosystem.

## ✨ Features

- **Blazing Fast Routing:** Custom `O(1)` Radix Trie implementation for deterministic, hyper-fast static and dynamic route matching (`/users/:id`).
- **Robust Lifecycle Engine:** Full asynchronous hook support (`onRequest`, `preHandler`, `onPostHandler`, `onError`) for building powerful plugins.
- **Native Zod Validation:** Built-in schema validation with safe, getter-bypassing request mutation.
- **Centralized Error Dispatcher:** Guaranteed execution of `onError` hooks (like file cleanup) before standardizing the HTTP error response.
- **Memory Safe:** Strict object reference persistence to prevent memory leaks and drop-outs during complex asynchronous request lifecycles.

## 📦 Installation

You typically install the core alongside your preferred validation library (like Zod):

```bash
npm install @axiomify/core zod
````

## 🚀 Quick Start (Internal API)

While developers usually interact with Axiomify through an adapter (e.g., `@axiomify/fastify`), the core engine can be utilized programmatically:

```typescript
import { Axiomify } from '@axiomify/core';
import { z } from 'zod';

const app = new Axiomify();

// 1. Register Global Hooks
app.addHook('onRequest', async (req, res) => {
  console.log(`[${req.id}] Incoming ${req.method} ${req.path}`);
});

// 2. Register Routes with Validation
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
    
    return res.status(201).send({ 
      success: true, 
      user: { email, name } 
    });
  }
});

// 3. Process Requests (Usually handled by your Adapter)
// await app.handle(mockReq, mockRes);
```

## 🧩 The Adapter Ecosystem

`@axiomify/core` is designed to be the underlying engine. To use it in a real server, pair it with one of our official adapters:

  - [`@axiomify/fastify`](https://www.npmjs.com/package/@axiomify/fastify) - For maximum throughput.
  - [`@axiomify/express`](https://www.npmjs.com/package/@axiomify/express) - For maximum compatibility.
  - [`@axiomify/hapi`](https://www.npmjs.com/package/@axiomify/hapi) - For enterprise environments.
  - [`@axiomify/http`](https://www.npmjs.com/package/@axiomify/http) - For zero-dependency edge deployments.

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
