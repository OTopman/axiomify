# @axiomify/upload

RAM-safe, stream-based multipart file upload for Axiomify. Files stream directly to disk via Busboy — no buffering in memory.

## Install

```bash
npm install @axiomify/upload @axiomify/core busboy zod
```

## Quick start

```typescript
import { Axiomify } from '@axiomify/core';
import { useUpload } from '@axiomify/upload';
import { z } from 'zod';

const app = new Axiomify();

// 1. Register the upload hook — once, before any routes
useUpload(app);

// 2. Declare file fields in route schema
app.route({
  method: 'POST',
  path: '/avatar',
  schema: {
    body: z.object({ userId: z.string() }),  // text fields
    files: {
      avatar: {
        autoSaveTo: './uploads/avatars',
        accept: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: 5 * 1024 * 1024,  // 5 MB per file
      },
    },
  },
  handler: async (req, res) => {
    const { userId } = req.body;
    const file = req.files!.avatar;

    // file.path       — absolute path on disk
    // file.originalName — original filename (sanitized)
    // file.savedName    — name on disk
    // file.mimeType   — detected MIME type
    // file.size       — bytes written

    res.send({ userId, avatarPath: file.path });
  },
});
```

## Options — `useUpload(app, options?)`

| Option | Default | Description |
|---|---|---|
| `dest` | `os.tmpdir()` | Default save directory for files without `autoSaveTo`. |
| `limits.fileSize` | `10 MiB` | Global max file size in bytes. Per-field `maxSize` overrides this. |
| `limits.files` | `10` | Max number of files per request. |
| `limits.fields` | `50` | Max number of text fields per request. |
| `limits.fieldSize` | `1 MiB` | Max text field value size in bytes. |

## Per-field `files` schema

```typescript
schema: {
  files: {
    // Field name in the multipart form
    profilePhoto: {
      autoSaveTo: './uploads/photos',   // directory to save to
      accept: ['image/jpeg', 'image/png'],  // MIME type allowlist
      maxSize: 2 * 1024 * 1024,         // 2 MB (overrides global limit)
    },
    resume: {
      autoSaveTo: './uploads/resumes',
      accept: ['application/pdf'],
      maxSize: 10 * 1024 * 1024,        // 10 MB
    },
  },
}
```

## Security

- **Path traversal:** original filenames are sanitized — `../../../etc/passwd` attempts are rejected with 400.
- **MIME type validation:** files with disallowed MIME types are rejected. Checks the actual content-type from Busboy, not just the file extension.
- **Size limits:** enforced on the stream — clients cannot bypass the limit by omitting `Content-Length`.
- **Automatic cleanup:** if the handler throws, validation fails, or the client disconnects, any partially written files are automatically deleted via the `onError` hook.

## Multiple files, same field

```typescript
schema: {
  files: {
    attachments: {
      autoSaveTo: './uploads/attachments',
      accept: ['application/pdf', 'image/jpeg'],
      maxSize: 5 * 1024 * 1024,
    },
  },
},
handler: async (req, res) => {
  // req.files.attachments is an array when multiple files share the same field name
  const files = Array.isArray(req.files!.attachments)
    ? req.files!.attachments
    : [req.files!.attachments];

  res.send({ count: files.length, paths: files.map(f => f.path) });
},
```

## Adapter compatibility

Works with all Axiomify adapters:
- **`@axiomify/http`** — raw stream passed through directly
- **`@axiomify/express`** — adapter passes the raw Node.js `IncomingMessage` stream
- **`@axiomify/fastify`** — the Fastify adapter registers a `multipart/form-data` content-type parser that passes the raw stream through; upload handles it normally
- **`@axiomify/hapi`** — Hapi adapter configures `parse: false, output: 'stream'` for all routes
- **`@axiomify/native`** — the uWS stream is passed to Busboy as a Node.js `Readable`

## Graceful shutdown

Files in progress when the server shuts down may be partially written. Call `adapter.close()` with a timeout to drain in-flight requests before exit:

```typescript
process.on('SIGTERM', async () => {
  await adapter.close();
  process.exit(0);
});
```
