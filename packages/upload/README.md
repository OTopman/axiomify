# @axiomify/upload


[![npm version](https://img.shields.io/npm/v/@axiomify/@axiomify/upload.svg)](https://npmjs.com/package/@axiomify/@axiomify/upload)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg?token=QSI2WR3YWZ)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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
## Graceful shutdown

Files in progress when the server shuts down may be partially written. Call `adapter.close()` with a timeout to drain in-flight requests before exit:

```typescript
process.on('SIGTERM', async () => {
  await adapter.close();
  process.exit(0);
});
```
