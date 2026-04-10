# 🌌 Axiomify

**Fastify-level speed. NestJS-level structure. Zero compromises.**

Axiomify is a high-performance, schema-first Node.js framework engineered for strict type safety and minimal runtime overhead. By unifying routing, validation, and request handling into a single declarative source of truth, Axiomify eliminates middleware fragmentation. 

Built on a modular, adapter-driven architecture, Axiomify allows you to write your business logic once and deploy it across Express, Fastify, Hapi, or Native HTTP interchangeably.

---

## ⚡ Core Architecture

* **Custom Radix Tree Router:** Engineered from the ground up using a highly optimized `TrieNode` structure. Endpoint resolution occurs instantaneously (O(k), where k = path depth), bypassing O(n) array-looping bottlenecks.
* **Ahead-of-Time Zod Compilation:** Validation schemas are compiled *once* during server bootstrap via the `ValidationCompiler`. This guarantees zero-overhead runtime validation while providing flawless, out-of-the-box TypeScript inference for `req.body`, `req.query`, and `req.params`.
*  **Asynchronous Hook Engine:** A deterministic lifecycle manager (`onPreHandler`, `onError`) that executes plugins securely before validation phases.
* **Adapter Pattern:** The framework is runtime-agnostic. The core engine (`@axiomify/core`) parses the declarative schema, while dedicated adapters (`@axiomify/express`, `@axiomify/fastify`) bridge the gap to the underlying server implementation.

---

## 📦 The Workspace Ecosystem

Axiomify is distributed as a suite of interoperable packages. Install only what you need:

| Package | Description |
| :--- | :--- |
| **`@axiomify/core`** | The high-performance routing engine, lifecycle hook manager, and validation compiler. |
| **`@axiomify/cli`** | Scaffolding and development tools (`dev`, `build`, `routes` visualization). |
| **`@axiomify/express`** | The Express.js adapter bridging Axiomify's core to an Express runtime. |
| **`@axiomify/fastify`** | The Fastify adapter for maximum throughput. |
| **`@axiomify/http`** | Native Node.js `http` module adapter for zero-dependency deployments. |
| **`@axiomify/hapi`** | The Hapi.js adapter. |
| **`@axiomify/openapi`** | Auto-generates Swagger/OpenAPI documentation derived directly from your Zod schemas. |
| **`@axiomify/upload`** | RAM-safe, stream-based multipart/form-data parsing for secure file uploads. |

---

## 🚀 Comprehensive Guide

### 1. Installation & CLI Scaffolding

The fastest way to start building is using the Axiomify CLI. 

```bash
# Install the CLI globally (or run via npx)
npm install -g @axiomify/cli

# Scaffold a new project
axiomify init my-api
cd my-api
npm install
```

The CLI ships with an ultra-fast esbuild development server and route visualization:

```npm run dev``` — Starts the high-speed hot-reloading dev server.

```npm run build``` — Compiles the TypeScript application for production.

```npm run routes``` — Prints a beautiful terminal table of all registered routes and their schema validations.

### 2. The Declarative Route (Native Zod Server)

Axiomify utilizes a strict, declarative syntax. Your schema *is* your contract. Define your route, schema, and handler in a single configuration block. 

```typescript
// src/index.ts
import { Axiomify, z } from '@axiomify/core';
import { ExpressAdapter } from '@axiomify/express';

const app = new Axiomify();

app.route({
  method: 'POST',
  path: '/products',
  schema: {
    body: z.object({
      name: z.string().min(2),
      price: z.number().positive(),
      tags: z.array(z.string()).default([]),
    }),
  },
  handler: async (req, res) => {
    // 🛡️ Type Safety: req.body is immediately typed as: 
    // { name: string, price: number, tags: string[] }
    // The validation layer has already executed before this line.
    const product = req.body;

    // Utilize Axiomify's rigid response interface
    res.status(201).send(product, 'Product created');
  },
});

const adapter = new ExpressAdapter(app);
adapter.listen(3000, () => {
  console.log('🌌 Axiomify engine listening on port 3000');
});
```

**Wildcard routes**

Use `*` as the final path segment to match any remainder. The captured
portion is available as `req.params['*']`:

```typescript
app.route({
  method: 'GET',
  path: '/files/*',
  handler: async (req, res) => {
    const filePath = req.params['*']; // e.g. 'images/logo.png'
    res.status(200).send({ path: filePath });
  },
});

---
**Response schema validation**

When a `response` schema is defined, Axiomify validates the payload passed to
`res.send()` after your handler returns.

- In **development** (`NODE_ENV !== 'production'`): a mismatch throws a
  `ValidationError` and logs the field errors to stderr. Your HTTP response
  is already sent — this is a developer-visible signal only, not a client error.
- In **production**: a mismatch logs a `console.warn` to stderr and does not
  affect the response in any way.

The response schema is also used by `@axiomify/openapi` to generate the OpenAPI
response body definition — so defining it serves both validation and documentation.

```typescript
app.route({
  method: 'GET',
  path: '/users/:id',
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  handler: async (req, res) => {
    res.status(200).send({ id: req.params.id, name: 'Alice' });
  },
});

### 3. RAM-Safe File Uploads (The Streaming Engine)
Traditional Node.js frameworks buffer file uploads into RAM, causing massive memory spikes and crashes under load. Axiomify's @axiomify/upload package uses a native Busboy stream pipeline to pipe multipart data directly to the hard drive, bypassing RAM entirely.

It integrates flawlessly with your route configuration:
```typescript
import { useUpload } from '@axiomify/upload';
import path from 'path';

// Inject the plugin globally
useUpload(app);

app.route({
  method: 'POST',
  path: '/upload-avatar',
  schema: {
    // Files are validated before the handler executes
    files: {
      avatar: {
        accept: ['image/png', 'image/jpeg'],
        maxSize: 5 * 1024 * 1024, // 5MB limit
        autoSaveTo: path.join(__dirname, '../uploads'),
        rename: async (originalName) => `${Date.now()}-${originalName}`,
      },
    },
  },
  handler: async (req, res) => {
    // The file is already securely saved to disk by the time the handler runs.
    // If the file exceeded 5MB, the request would have short-circuited safely.
    const uploadedFile = req.files.avatar;

    res.status(200).send({
      savedName: uploadedFile.savedName,
      path: uploadedFile.path,
      size: uploadedFile.size,
    });
  },
});
```
_**Note**: If an error is thrown anywhere in the handler or validation layer, the built-in onError hook automatically scrubs the filesystem of any orphaned/partially uploaded files._

### 4. Auto-Generated OpenAPI Documentation

Stop maintaining disconnected Swagger files. Axiomify reads your registered route schemas and generates documentation on the fly.

```typescript
import { useOpenAPI } from '@axiomify/openapi';

// Inject the OpenAPI System
useOpenAPI(app, {
  routePrefix: '/docs',
  info: {
    title: 'Axiomify Production API',
    version: '1.0.0',
    description: 'Auto-generated high-performance API documentation',
  },
});
```

### 5. Hook Engine & Lifecycle Management

Axiomify exposes an execution lifecycle allowing you to intercept requests predictably. Hooks are executed *before* validation, allowing plugins (like file upload streams) to populate the request object.

```typescript
app.addHook('onPreHandler', async (req, res, match) => {
  console.log(`[ENGINE] Request arrived for: ${match.route.path}`);
  
  // Custom authentication logic can be injected here
  const token = req.headers['authorization'];
  if (!token) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }
});

app.addHook('onError', (err, req, res) => {
  console.error(`[CRITICAL] Error at ${req.path}:`, err);
});
```

### 6. Seamless Server Adapters

Axiomify decouples the routing logic from the HTTP server implementation. You can hot-swap your underlying web server without changing a single line of your business logic or route configurations.

```typescript
// Using Express
import { ExpressAdapter } from '@axiomify/express';
new ExpressAdapter(app).listen(3000);

// Using Fastify
import { FastifyAdapter } from '@axiomify/fastify';
new FastifyAdapter(app).listen(3000);

// Using Native Node HTTP
import { HttpAdapter } from '@axiomify/http';
new HttpAdapter(app).listen(3000);
```

### 7. Error Handling Architecture

Errors thrown inside handlers or hooks are automatically caught by Axiomify's centralized error dispatcher. 

If Zod schema validation fails during the `validator.execute()` phase, Axiomify automatically short-circuits the request and returns the parsed Zod issues directly to the client, mapped safely against your environment variables (hiding stack traces in production automatically).

### 8. Route-specific plugins

Axiomify allows execution of specific middleware plugins per-route. Route plugins run in array order after global `onPreHandler` hooks but before schema validation.

**💡 Pro-Tip: Enable IntelliSense**
To get strict TypeScript autocomplete for your plugin names, augment the `@axiomify/core` module anywhere in your project:

```typescript
declare module '@axiomify/core' {
  interface RegisteredPlugins {
    requireAuth: void;
    requireAdmin: void;
  }
}
```

```typescript
// 1. Register the plugins globally before defining routes
app.registerPlugin('requireAuth', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) {
    res.status(401).send(null, 'Unauthorized');
    // Returning after sending — the framework checks res.headersSent
    // and will not call subsequent plugins or the handler
  }
});

app.registerPlugin('requireAdmin', async (req, res) => {
  const role = (req.state as any).role;
  if (role !== 'admin') {
    res.status(403).send(null, 'Forbidden');
  }
});

// 2. Attach named plugins to specific routes
app.route({
  method: 'DELETE',
  path: '/users/:id',
  plugins: ['requireAuth', 'requireAdmin'], // Runs in this order
  handler: async (req, res) => {
    res.status(200).send(null, 'User deleted');
  },
});
```

### 9. Request Timeouts

Set a global timeout in milliseconds via the Axiomify constructor. Any handler
that does not call res.send() within the window automatically receives a 503:

```typescript
const app = new Axiomify({ timeout: 5000 }); // 5 seconds global default
```

Override per-route with the timeout field on any route definition:

```typescript
app.route({
  method: 'POST',
  path: '/heavy-job',
  timeout: 30_000, // 30 seconds for this route only
  handler: async (req, res) => { ... },
});
```
Set timeout: 0 (the default) to disable timeouts entirely.