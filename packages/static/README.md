# @axiomify/static

[![npm version](https://img.shields.io/npm/v/@axiomify/static.svg)](https://npmjs.com/package/@axiomify/static)
[![codecov](https://codecov.io/github/otopman/axiomify/graph/badge.svg)](https://codecov.io/github/otopman/axiomify)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/OTopman/axiomify/badge)](https://securityscorecards.dev/viewer/?uri=github.com/OTopman/axiomify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Static file serving for Axiomify with ETag caching, HTTP Range requests (RFC 9110), configurable cache control, and path traversal protection.

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

| Option                    | Default                             | Description                                                                      |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `prefix`                  | required                            | URL path prefix (e.g. `'/public'`, `'/'`).                                       |
| `root`                    | required                            | Filesystem directory to serve files from.                                        |
| `cacheControl`            | `'public, max-age=86400'`           | `Cache-Control` header value for all files.                                      |
| `forceDownloadExtensions` | `['.svg', '.html', '.htm', '.xml']` | Extensions served with `Content-Disposition: attachment`. Prevents SVG/HTML XSS. |
| `serveIndex`              | `true`                              | Serve `index.html` when a directory path is requested.                           |

## Cache control examples

```typescript
// Immutable content-hashed assets (JS bundles, CSS)
serveStatic(app, {
  prefix: '/assets',
  root: './dist',
  cacheControl: 'public, max-age=31536000, immutable',
});

// API responses / no caching
serveStatic(app, { prefix: '/data', root: './data', cacheControl: 'no-store' });

// CDN with stale-while-revalidate
serveStatic(app, {
  prefix: '/media',
  root: './media',
  cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
});
```

## Supported MIME types

| Extension                                | Content-Type                            |
| ---------------------------------------- | --------------------------------------- |
| `.html`, `.htm`                          | `text/html; charset=utf-8`              |
| `.css`                                   | `text/css; charset=utf-8`               |
| `.js`, `.mjs`                            | `application/javascript; charset=utf-8` |
| `.json`                                  | `application/json; charset=utf-8`       |
| `.png`, `.jpg`, `.gif`, `.webp`, `.avif` | `image/*`                               |
| `.svg`                                   | `image/svg+xml`                         |
| `.woff`, `.woff2`, `.ttf`                | `font/*`                                |
| `.mp4`, `.webm`, `.mp3`, `.wav`          | `video/*`, `audio/*`                    |
| `.pdf`                                   | `application/pdf`                       |
| `.csv`                                   | `text/csv; charset=utf-8`               |
| `.yaml`, `.yml`                          | `application/yaml`                      |
| `.wasm`                                  | `application/wasm`                      |
| `.ico`                                   | `image/x-icon`                          |
| anything else                            | `application/octet-stream`              |

## Range requests

Real files are served with `Accept-Ranges: bytes` and `Last-Modified`, and honor single
byte-range requests (RFC 9110) — video seeking and resumable downloads work out of the box.

- `bytes=0-499` / `bytes=500-` / `bytes=-500` → `206 Partial Content` with `Content-Range`
  and an exact `Content-Length`; the slice is streamed via `createReadStream(start, end)`.
- Unsatisfiable ranges (start past EOF, `bytes=-0`) → `416` with `Content-Range: bytes */<size>`.
- Multi-range and malformed `Range` headers fall back to the full `200` response.
- `If-Range` (ETag or HTTP-date) downgrades to a full `200` when the file changed.
- `If-None-Match` takes precedence: a matching ETag returns `304`.
- Range applies to real files only — the directory `index.html` fallback ignores it.

## Security

- **Path traversal**: resolved paths must stay within `root`. `../` sequences return 403.
- **Null bytes**: requests containing `\0` return 403.
- **SVG/HTML XSS**: these extensions are served with `Content-Disposition: attachment` by
  default so browsers download them instead of rendering. Override with `forceDownloadExtensions: []`.
- **ETag**: weak ETags based on file size and mtime. `If-None-Match` returns 304.

## Directory index

```typescript
serveStatic(app, {
  prefix: '/',
  root: './dist',
  serveIndex: true, // default — serves index.html for directory requests
  cacheControl: 'no-store', // don't cache the HTML shell
});
```

`serveIndex` serves `index.html` when a **directory** path is requested (e.g. `/` → `./dist/index.html`).
It is not a catch-all SPA rewrite: a request for a non-existent path such as `/client/route`
returns `404`, not `index.html`. For client-side routing, add a fallback route of your own that
returns the HTML shell for unmatched paths.
