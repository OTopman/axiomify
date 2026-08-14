# @axiomify/upload

[![npm version](https://img.shields.io/npm/v/@axiomify/upload.svg)](https://npmjs.com/package/@axiomify/upload)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
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
    body: z.object({ userId: z.string() }), // text fields
    files: {
      avatar: {
        autoSaveTo: './uploads/avatars',
        accept: ['image/jpeg', 'image/png', 'image/webp'],
        maxSize: 5 * 1024 * 1024, // 5 MB per file
      },
    },
  },
  handler: async (req, res) => {
    const { userId } = req.body;
    const file = req.files!.avatar;

    // file.path         — path on disk
    // file.originalName — original filename (unsanitized, as reported by the client)
    // file.savedName    — name on disk (sanitized; randomized unless preserved)
    // file.mimetype     — MIME type reported in the multipart part header
    // file.size         — bytes written

    res.send({ userId, avatarPath: file.path });
  },
});
```

## Options — `useUpload(app, options?)`

| Option        | Default | Description                                                                   |
| ------------- | ------- | ----------------------------------------------------------------------------- |
| `autoCleanup` | `false` | Automatically delete all uploaded temporary files after the handler finishes. |

All request-level multipart limits are derived from the per-field `files` schema, not
from `useUpload` options: the file count ceiling is the sum of each field's `maxFiles`,
and the per-field `maxSize` values are enforced per byte written. Multipart field limits
are fixed at 100 text fields and 64 KiB per field value.

## Per-field `files` schema

Each field in `schema.files` is configured with the following properties. `accept` and
`maxSize` are required; the rest are optional.

| Property               | Required | Default | Description                                                                                 |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------- |
| `accept`               | yes      | —       | MIME type allowlist (exact types or `type/*` wildcards).                                    |
| `maxSize`              | yes      | —       | Max size in bytes per file, enforced on the stream.                                         |
| `autoSaveTo`           | yes      | —       | Directory to save files to (created recursively if missing).                                |
| `maxFiles`             | no       | `1`     | Max number of files accepted for this field.                                                |
| `preserveOriginalName` | no       | `false` | Keep the (sanitized) original filename instead of generating a random UUID name.            |
| `rename`               | no       | —       | `(originalName, mimetype) => string \| Promise<string>` to compute the saved filename.      |
| `validateContent`      | no       | `true`  | Verify the saved file's magic bytes against `accept`. Set `false` to skip content sniffing. |

```typescript
schema: {
  files: {
    // Field name in the multipart form
    profilePhoto: {
      autoSaveTo: './uploads/photos',   // directory to save to
      accept: ['image/jpeg', 'image/png'],  // MIME type allowlist
      maxSize: 2 * 1024 * 1024,         // 2 MB per file
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

- **Path traversal:** filenames are sanitized (path separators and parent-directory
  segments stripped) and the resolved save path is verified to stay inside `autoSaveTo`.
- **MIME type validation:** the multipart part's declared MIME type is checked against
  `accept` as a fast pre-check, then the saved file's actual **magic bytes** are always
  sniffed and matched against `accept` (unless `validateContent: false`). The
  client-declared content-type is never trusted on its own.
- **Fail closed on undetectable content:** if the magic bytes cannot be identified, the
  file is rejected — unless the field's `accept` explicitly opts into a non-sniffable type
  (e.g. `text/csv`, `application/octet-stream`).
- **SVG XSS:** a generic wildcard such as `image/*` never admits `image/svg+xml` (which can
  carry stored XSS). SVG is only accepted when `'image/svg+xml'` is listed explicitly in `accept`.
- **Size limits:** enforced on the stream per byte written — clients cannot bypass the limit by omitting `Content-Length`.
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

## File Cleanup

If the request handler throws an error, validation fails, or the client disconnects before completion, any partially written files are automatically deleted via the `@axiomify/upload` `onError` hook.

For successful requests, you can clean up files automatically or manually:

1. **Automatic Cleanup**: Pass `autoCleanup: true` when registering `useUpload`. This deletes all successfully uploaded temporary files after the route handler finishes execution:

   ```typescript
   useUpload(app, { autoCleanup: true });
   ```

2. **Manual Cleanup**: Call `req.cleanup()` within your route handler after you have processed the files (e.g. after uploading them to S3 or copying them):

   ```typescript
   handler: async (req, res) => {
     const file = req.files!.avatar;
     await uploadToS3(file.path);

     // Delete the local temporary file
     await req.cleanup?.();

     res.send({ status: 'uploaded' });
   };
   ```

## Graceful shutdown

Files in progress when the server shuts down may be partially written. Call `adapter.close()` with a timeout to drain in-flight requests before exit:

```typescript
process.on('SIGTERM', async () => {
  await adapter.close();
  process.exit(0);
});
```
