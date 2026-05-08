# @axiomify/static

Static file serving for Axiomify with ETag caching, configurable cache control, and path traversal protection.

## Install

```bash
npm install @axiomify/static
```

## Quick start

```typescript
import { serveStatic } from '@axiomify/static';

serveStatic(app, {
  prefix: '/public',
  root: './public',
});
// Serves GET /public/* from ./public/
```

## Options

| Option | Default | Description |
|---|---|---|
| `prefix` | required | URL path prefix (e.g. `'/public'`, `'/'`). |
| `root` | required | Filesystem directory to serve files from. |
| `cacheControl` | `'public, max-age=86400'` | `Cache-Control` header value for all files. |
| `forceDownloadExtensions` | `['.svg', '.html', '.htm', '.xml']` | Extensions served with `Content-Disposition: attachment`. Prevents SVG/HTML XSS. |
| `serveIndex` | `true` | Serve `index.html` when a directory path is requested. |

## Cache control examples

```typescript
// Immutable content-hashed assets (JS bundles, CSS)
serveStatic(app, { prefix: '/assets', root: './dist', cacheControl: 'public, max-age=31536000, immutable' });

// API responses / no caching
serveStatic(app, { prefix: '/data', root: './data', cacheControl: 'no-store' });

// CDN with stale-while-revalidate
serveStatic(app, { prefix: '/media', root: './media', cacheControl: 'public, max-age=3600, stale-while-revalidate=86400' });
```

## Supported MIME types

| Extension | Content-Type |
|---|---|
| `.html`, `.htm` | `text/html; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.js`, `.mjs` | `application/javascript; charset=utf-8` |
| `.json` | `application/json; charset=utf-8` |
| `.png`, `.jpg`, `.gif`, `.webp`, `.avif` | `image/*` |
| `.svg` | `image/svg+xml` |
| `.woff`, `.woff2`, `.ttf` | `font/*` |
| `.mp4`, `.webm`, `.mp3`, `.wav` | `video/*`, `audio/*` |
| `.pdf` | `application/pdf` |
| `.csv` | `text/csv; charset=utf-8` |
| `.yaml`, `.yml` | `application/yaml` |
| `.wasm` | `application/wasm` |
| `.ico` | `image/x-icon` |
| anything else | `application/octet-stream` |

## Security

- **Path traversal**: resolved paths must stay within `root`. `../` sequences return 403.
- **Null bytes**: requests containing `\0` return 403.
- **SVG/HTML XSS**: these extensions are served with `Content-Disposition: attachment` by
  default so browsers download them instead of rendering. Override with `forceDownloadExtensions: []`.
- **ETag**: weak ETags based on file size and mtime. `If-None-Match` returns 304.

## SPA fallback

```typescript
// Serve index.html for all unmatched paths (SPA routing)
serveStatic(app, {
  prefix: '/',
  root: './dist',
  serveIndex: true,   // default — serves index.html for directory requests
  cacheControl: 'no-store', // don't cache the HTML shell
});
```
