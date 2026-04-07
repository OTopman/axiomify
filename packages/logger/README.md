# @axiomify/logger

The official, security-first logging plugin for the Axiomify framework. 

`@axiomify/logger` provides high-performance, asynchronous request and response logging. Built with DevSecOps in mind, it automatically intercepts outgoing payloads and sanitizes Personally Identifiable Information (PII) before it ever reaches your stdout.

## ✨ Features

- **Secure by Default:** Integrates seamlessly with `maskify-ts` to automatically redact sensitive fields (like passwords, API keys, and credit cards) from your logs.
- **Guaranteed Capture:** Injects deeply into Axiomify's `onRequest` lifecycle phase to safely wrap `res.send`, guaranteeing that all outgoing responses are logged, even if the developer's handler terminates early.
- **Stable Tracing:** Utilizes Axiomify's stable request IDs to perfectly correlate incoming requests with their corresponding outgoing responses.
- **Low Overhead:** Designed for production environments where synchronous logging could otherwise bottleneck throughput.

## 📦 Installation

Ensure you install the logger alongside the Axiomify core and the masking utility:

```bash
npm install @axiomify/logger @axiomify/core maskify-ts
````

## 🚀 Quick Start

The logger is designed as a drop-in plugin for your Axiomify core engine. You only need to register it once, and it will automatically handle request tracing across all your routes.

```typescript
import { Axiomify } from '@axiomify/core';
import { useLogger } from '@axiomify/logger';
import { z } from 'zod';

// 1. Initialize the Axiomify Core Engine
const app = new Axiomify();

// 2. Attach the Logger Plugin
// This will automatically hook into 'onRequest' to trace incoming traffic
// and wrap response methods to safely log outgoing payloads.
useLogger(app, {
  level: 'info',
  // Configure maskify-ts to redact specific sensitive keys
  maskKeys: ['password', 'token', 'creditCard', 'authorization'] 
});

// 3. Register your routes normally
app.route({
  method: 'POST',
  path: '/login',
  schema: {
    body: z.object({
      email: z.string().email(),
      password: z.string() // <-- The logger will automatically redact this!
    })
  },
  handler: async (req, res) => {
    // The logger captures this outgoing payload but redacts the token
    return res.status(200).send({ 
      success: true, 
      token: 'super-secret-jwt' 
    });
  }
});

// 4. Mount to your preferred adapter (Express, Fastify, HTTP, etc.)
// await app.handle(req, res);
```

## 🔍 Log Output Example

Because the logger intercepts the response payload and passes it through the auto-masker, your production console remains clean and compliant:

```text
[INFO] [req-uuid-1234] Incoming POST /login
[INFO] [req-uuid-1234] Outgoing response: { "success": true, "token": "[REDACTED]" }
```

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
