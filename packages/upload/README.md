# @axiomify/upload

The official, high-performance multipart file upload plugin for the Axiomify framework. 

`@axiomify/upload` is built for maximum efficiency and security. It bypasses memory-hogging buffers by streaming `multipart/form-data` directly to disk, making it completely RAM-safe for massive file payloads.

## ✨ Features

- **RAM-Safe Streaming:** Powered by `busboy` under the hood. Files are streamed directly to the hard drive or cloud storage buffer, preventing memory exhaustion attacks (OOM).
- **Guaranteed Cleanup:** Hooks deep into Axiomify's `onError` lifecycle phase. If a route handler throws an error, validation fails, or the client aborts the connection, the plugin automatically deletes any orphaned or partially uploaded files.
- **Pre-Validation Hook:** Executes perfectly during the `preHandler` phase, meaning `req.body` (text fields) and `req.files` (streams) are fully populated *before* your Zod schemas execute.
- **Adapter Agnostic:** Seamlessly handles streams from Express, Fastify, Hapi, and native HTTP.

## 📦 Installation

Ensure you install the upload plugin alongside the Axiomify core and the underlying Busboy engine:

```bash
npm install @axiomify/upload @axiomify/core busboy zod
````

## 🚀 Quick Start

Attaching the upload engine to your Axiomify instance handles all the complex streaming logistics automatically.

```typescript
import { Axiomify } from '@axiomify/core';
import { useUpload } from '@axiomify/upload';
import { z } from 'zod';

// 1. Initialize the Axiomify Core Engine
const app = new Axiomify();

// 2. Attach the Upload Plugin
// This registers the 'preHandler' streaming parser and the 'onError' cleanup hook
useUpload(app, {
  dest: './tmp/uploads', // Local directory for streamed files
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 5 // Maximum of 5 files per request
  }
});

// 3. Register your routes
app.route({
  method: 'POST',
  path: '/users/avatar',
  schema: {
    // Standard text fields are automatically parsed from the multipart form
    body: z.object({
      userId: z.string() 
    })
  },
  handler: async (req, res) => {
    // The plugin safely attaches the completed file metadata to req.files
    const avatar = req.files['avatar'];
    const { userId } = req.body;

    if (!avatar) {
      // If we throw here, the 'onError' hook automatically deletes 
      // any other files that may have been uploaded in this request!
      return res.status(400).send({ error: 'Avatar file is required' });
    }

    return res.status(200).send({ 
      success: true, 
      message: `Avatar for ${userId} safely streamed to ${avatar.path}` 
    });
  }
});

// 4. Mount to your preferred adapter
// await app.handle(req, res);
```

<!-- ## ⚠️ Important Note for Fastify Users

If you are using `@axiomify/fastify`, Fastify natively rejects `multipart/form-data` with a `415 Unsupported Media Type` error before it reaches the Axiomify engine.

To unblock uploads, you must register a bypass parser on your Fastify instance *before* mounting the Axiomify adapter:

```typescript
// Bypass Fastify's strict media parser so the raw stream reaches Axiomify
fastifyApp.addContentTypeParser('multipart/form-data', (request, payload, done) => {
  done(null, payload); 
});

fastifyApp.register(FastifyAdapter(app));
``` -->

## 📚 Documentation

For complete documentation, guides, and advanced plugin authoring, please visit the [Axiomify Master Repository](https://github.com/OTopman/axiomify).

## 📄 License

MIT
