# @axiomify/openapi

The official OpenAPI 3.0 specification generator and Swagger UI plugin for the Axiomify framework.

`@axiomify/openapi` completely eliminates the need to maintain separate API documentation. It automatically introspects your Axiomify Radix router, parses your Zod validation schemas, and serves a fully interactive Swagger UI—guaranteeing that your documentation perfectly matches your runtime validation.

## ✨ Features

- **Zero-Touch Documentation:** Automatically converts your Zod request and response schemas into standard OpenAPI v3 JSON.
- **Embedded Swagger UI:** Serves a beautiful, interactive API explorer directly from your application without requiring external hosting.
- **Robust Pathing:** Bulletproof route prefix normalization ensures your documentation paths never break, regardless of trailing slashes in your configuration.
- **Always in Sync:** Because your route definitions drive the documentation, your API specs can never drift from your actual codebase.

## 📦 Installation

Ensure you install the OpenAPI plugin alongside the Axiomify core and your validation library:

```bash
npm install @axiomify/openapi @axiomify/core zod
````

## 🚀 Quick Start

Attaching the OpenAPI generator to your Axiomify instance takes only one line of code.

```typescript
import { Axiomify } from '@axiomify/core';
import { useOpenAPI } from '@axiomify/openapi';
import { z } from 'zod';

// 1. Initialize the Axiomify Core Engine
const app = new Axiomify();

// 2. Attach the OpenAPI Plugin
// This automatically mounts /docs (Swagger UI) and /docs/openapi.json (Raw Spec)
useOpenAPI(app, {
  routePrefix: '/docs', // Automatically handles trailing slash normalization
  info: {
    title: 'My Axiomify API',
    version: '1.0.0',
    description: 'Auto-generated API documentation.'
  }
});

// 3. Register your routes
// The plugin automatically detects this route, extracts the Zod schema,
// and builds the OpenAPI parameter definitions.
app.route({
  method: 'POST',
  path: '/users',
  schema: {
    body: z.object({
      email: z.string().email().openapi({ description: 'User email address' }),
      name: z.string().min(2).openapi({ description: 'Full name' })
    })
  },
  handler: async (req, res) => {
    const { email, name } = req.body;
    return res.status(201).send({ success: true, user: { email, name } });
  }
});

// 4. Mount to your preferred adapter and navigate to http://localhost:3000/docs
// await app.handle(req, res);
```

## 🛠️ Configuration Options

| Option | Type | Description |
| :--- | :--- | :--- |
| `routePrefix` | `string` | The base URL where the Swagger UI will be hosted (e.g., `/docs`). |
| `info` | `object` | Standard OpenAPI info object containing `title`, `version`, and `description`. |

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
