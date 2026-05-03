# @axiomify/static

Static file serving for Axiomify.

## API

`serveStatic(app, options)` registers a wildcard GET route under `prefix`.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `prefix` | `string` | required | URL prefix (e.g. `/assets`) |
| `root` | `string` | required | Filesystem root directory |
| `cacheControl` | `string` | `'public, max-age=86400'` | Cache-Control header value |
| `forceDownloadExtensions` | `string[]` | `['.svg', '.html', '.htm', '.xml']` | Served as `attachment` (download) |
| `serveIndex` | `boolean` | `true` | Serve `index.html` for directory paths |

## Supported MIME types

Covers 40+ types including WebP, AVIF, WASM, WOFF2, MP3, CSV, YAML, and all common web assets. Unknown extensions default to `application/octet-stream`.

## Security

- Path traversal blocked via `realpath` comparison before serving
- SVG/HTML forced to `Content-Disposition: attachment` by default — they execute JS when rendered inline
- ETag-based conditional GET (`If-None-Match` → 304) included automatically
