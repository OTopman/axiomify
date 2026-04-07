# @axiomify/hapi

The official Hapi adapter for the Axiomify framework. 

`@axiomify/hapi` brings Axiomify's ultra-fast Radix routing, Zod validation engine, and memory-safe plugin ecosystem to Hapi's battle-tested, enterprise-grade server environment. It allows you to build robust, highly configurable applications while maintaining maximum type safety.

## ✨ Features

- **Enterprise Ready:** Seamlessly integrates with Hapi's strict lifecycle and configuration-driven architecture.
- **Stable Object References:** Implements memory-safe proxying for `req.params` and `req.state` to ensure data persists perfectly across complex, multi-stage request lifecycles.
- **Native Zod Integration:** Fully supports Axiomify's core validation compilation and request mutations without triggering getter-lock exceptions.
- **Unified Ecosystem:** Share Axiomify plugins (like `@axiomify/upload`) across environments without writing Hapi-specific boilerplate.

## 📦 Installation

Ensure you install the adapter alongside the Axiomify core, Hapi, and your validation library of choice (like Zod):

```bash
npm install @axiomify/hapi @axiomify/core @hapi/hapi zod
````

## 🚀 Quick Start

Integrating Axiomify into a Hapi application is handled cleanly through Hapi's standard plugin registration system.

```typescript
import Hapi from '@hapi/hapi';
import { Axiomify } from '@axiomify/core';
import { HapiAdapter } from '@axiomify/hapi';
import { z } from 'zod';

const init = async () => {
  // 1. Initialize your standard Hapi server
  const server = Hapi.server({
    port: 3000,
    host: 'localhost'
  });

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

  // 4. Mount Axiomify onto Hapi
  // The adapter registers as a Hapi plugin and intercepts traffic safely
  await server.register(HapiAdapter(app));

  // 5. Start the Server
  await server.start();
  console.log(`🚀 Server listening on ${server.info.uri}`);
};

process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

init();
```

## 🧩 The Adapter Ecosystem

If you need to migrate to a different deployment architecture, Axiomify allows you to swap adapters with zero changes to your core routing or business logic:

  - [`@axiomify/fastify`](https://www.npmjs.com/package/@axiomify/fastify) - For maximum throughput.
  - [`@axiomify/express`](https://www.npmjs.com/package/@axiomify/express) - For maximum middleware compatibility.
  - [`@axiomify/http`](https://www.npmjs.com/package/@axiomify/http) - For zero-dependency edge deployments.

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
