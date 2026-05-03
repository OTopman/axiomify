# @axiomify/static

Static file serving for Axiomify with ETag caching, 36 MIME types, configurable cache control,
SPA index fallback, and path traversal protection.

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
// Serves GET /public/* → ./public/**
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | required | URL path prefix. Use `'/'` for root. |
| `root` | `string` | required | Filesystem directory to serve from. |
| `cacheControl` | `string` | `'public, max-age=86400'` | `Cache-Control` header value for all responses. |
| `forceDownloadExtensions` | `string[]` | `['.svg', '.html', '.htm', '.xml']` | Served with `Content-Disposition: attachment`. |
| `serveIndex` | `boolean` | `true` | Serve `index.html` for directory paths (SPA support). |

## Cache control

```typescript
// Long-lived, content-hashed assets (webpack/Vite output)
serveStatic(app, {
  prefix: '/assets',
  root: './dist/assets',
  cacheControl: 'public, max-age=31536000, immutable',
});

// HTML shell — always revalidate
serveStatic(app, {
  prefix: '/',
  root: './dist',
  cacheControl: 'no-cache',
  serveIndex: true,
});

// Private API response files — no caching
serveStatic(app, {
  prefix: '/exports',
  root: './exports',
  cacheControl: 'private, no-store',
});
```

## SPA (Single-Page Application)

```typescript
// Serve index.html for all paths — React Router / Vue Router etc.
serveStatic(app, {
  prefix: '/',
  root: './dist',
  cacheControl: 'no-cache',         // prevent stale HTML shell
  serveIndex: true,                 // default — serves index.html for directories
});
```

## Supported MIME types (36)

| Category | Extensions |
|---|---|
| Web | `.html`, `.htm`, `.css`, `.js`, `.mjs`, `.ts`, `.json`, `.xml`, `.txt`, `.md` |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`, `.webp`, `.avif`, `.bmp`, `.tiff` |
| Fonts | `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot` |
| Media | `.mp4`, `.webm`, `.ogg`, `.mp3`, `.wav`, `.flac` |
| Data | `.csv`, `.yaml`, `.yml` |
| Docs | `.pdf` |
| Archives | `.zip`, `.gz`, `.tar` |
| System | `.wasm` |
| Unknown | `application/octet-stream` |

## Security

- **Path traversal:** every request path is verified against `realpath()`. Any path that
  escapes the `root` directory returns 403.
- **Null bytes:** paths containing `\0` return 403.
- **SVG/HTML XSS:** by default, `.svg`, `.html`, `.htm`, `.xml` files are served with
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. This prevents
  browsers from rendering them inline — SVG and HTML can execute JavaScript as-is.
- **ETag:** weak ETags based on file size and mtime. `If-None-Match` returns 304 with no body.

## Override security defaults

```typescript
// Allow inline SVG (only if you trust your content and CSP is set)
serveStatic(app, {
  prefix: '/icons',
  root: './icons',
  forceDownloadExtensions: [],  // disable forced download
});
```
