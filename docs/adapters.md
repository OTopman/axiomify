

# Adapters in Axiomify

Axiomify is built on a **Shared-Nothing Core Architecture**. This means the framework's routing logic, validation, and serialization are completely decoupled from the underlying HTTP transport layer. 

By using **Adapters**, developers have the ultimate freedom to choose their execution environment. You can write your Axiomify application once, and seamlessly switch between blazing-fast C++ execution, standard Node.js environments, or legacy Express/Fastify applications without rewriting a single route.

## The Decision Matrix

Choose your adapter based on your project's specific requirements:

| Adapter | Throughput | Node.js Overheads | Best For... |
| :--- | :--- | :--- | :--- |
| **`NativeAdapter`** | **~45k - 70k req/sec** | Bypassed (C++ Engine) | Microservices, real-time WebSockets, raw API speed. |
| **`FastifyAdapter`** | ~30k req/sec | Medium | High-performance apps reliant on Fastify plugins. |
| **`HttpAdapter`** | ~25k req/sec | High | Serverless, Edge computing, zero-dependency deployments. |
| **`ExpressAdapter`** | ~12k req/sec | Maximum | Legacy migrations, maximum NPM ecosystem compatibility. |

---

## 1. The Native Adapter (`@axiomify/native`)

The Native Adapter is Axiomify’s hypercar. Powered under the hood by `uWebSockets.js`, it bypasses the standard Node.js HTTP parser entirely, mapping your routes directly to the V8 C++ event loop. 

It natively supports massive file uploads, backpressured stream delivery, and real-time WebSockets.

### Installation
```bash
npm install @axiomify/native
```

### Basic Initialization
```typescript
import { Axiomify } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';

const app = new Axiomify();

app.route({
  method: 'GET',
  path: '/api/speed',
  handler: async (req, res) => {
    res.send({ message: 'Running at C++ speeds' });
  }
});

// Initialize the adapter and bind it to a port
const server = new NativeAdapter(app, { port: 3000 });
server.listen(() => {
  console.log('Native Engine active on port 3000');
});
```

### Native WebSockets
The Native Adapter comes with an enterprise-grade WebSocket server built directly into the C++ core. By default, it automatically accepts connection upgrades on the `/ws` path, sharing the exact same port and memory space as your HTTP routes with zero collisions.

```typescript
// Clients can connect immediately via:
// const ws = new WebSocket('ws://localhost:3000/ws');
```

### The Express Compatibility Bridge
The Native Adapter prioritizes raw speed by using highly optimized `NativeRequest` and `NativeResponse` objects. However, if you need to use standard Express/Connect middleware (like `cors` or `helmet`), Axiomify provides a Just-In-Time (JIT) Polyfill bridge.

Use the `adaptMiddleware` utility to securely wrap legacy middleware so it runs flawlessly on the native engine.

```typescript
import cors from 'cors';
import { Axiomify } from '@axiomify/core';
import { NativeAdapter, adaptMiddleware } from '@axiomify/native';

const app = new Axiomify();

// Wrap standard Express middleware for the C++ engine
app.use(adaptMiddleware(cors()));

app.route({
  method: 'GET',
  path: '/secure',
  handler: async (req, res) => {
    res.send({ status: 'CORS enabled natively' });
  }
});

const server = new NativeAdapter(app, { port: 3000 });
server.listen();
```
> **Note:** Bridging Express middleware incurs a slight performance penalty (~15k req/sec drop) due to memory allocation for the Node.js polyfills. For maximum performance, use Axiomify's first-party native plugins (e.g., `@axiomify/cors`).

---

## 2. The HTTP Adapter (`@axiomify/http`)

The Universal Standard. This adapter uses the native `node:http` module. It requires zero external C++ binaries, making it the perfect choice for highly restrictive CI/CD pipelines, Docker containers, or Edge environments.

```typescript
import { Axiomify } from '@axiomify/core';
import { HttpAdapter } from '@axiomify/http';

const app = new Axiomify();
// ... define routes ...

const server = new HttpAdapter(app);
server.listen(3000, () => console.log('Node HTTP server active'));
```

---

## 3. The Migration Adapters (Express & Fastify)

If you are migrating a massive legacy application, you do not need to rewrite your entire codebase at once. You can mount your blazing-fast Axiomify application *inside* your existing Express or Fastify server.

### Express Adapter Example
```typescript
import express from 'express';
import { Axiomify } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';

const legacyApp = express();
const axiomifyApp = new Axiomify();

// Define your modern Axiomify routes
axiomifyApp.route({
  method: 'GET',
  path: '/v2/users',
  handler: async (req, res) => res.send({ modern: true })
});

// Mount Axiomify onto the legacy Express app
legacyApp.use('/api', ExpressAdapter(axiomifyApp));

legacyApp.listen(3000);
```

### Fastify Adapter Example
```typescript
import Fastify from 'fastify';
import { Axiomify } from '@axiomify/core';
import { FastifyAdapter } from '@axiomify/fastify';

const fastify = Fastify();
const axiomifyApp = new Axiomify();

// ... define Axiomify routes ...

// Register Axiomify as a Fastify plugin
fastify.register(FastifyAdapter(axiomifyApp));

fastify.listen({ port: 3000 });
```