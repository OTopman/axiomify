# @axiomify/static

Secure static file serving with directory traversal protection, streaming responses, and 304 Not Modified support.

## Installation

```bash
npm install @axiomify/static
```

## Quick Start

```typescript
import { Axiomify } from '@axiomify/core';
import { useStatic } from '@axiomify/static';

const app = new Axiomify();

// Serve files from ./public
useStatic(app, {
  directory: './public',
  route: '/static', // Access via http://localhost:3000/static/file.js
});

// All files under ./public are now publicly served
```

## Features

- **Secure by Default**: Path traversal attempts (`../../../etc/passwd`) are rejected with 400
- **Streaming Responses**: Large files are streamed (not buffered) to minimize memory
- **304 Not Modified**: Respects `If-None-Match` and `ETag` headers for efficient caching
- **Directory Traversal Protected**: Only files under the configured directory are served
- **Gzip Support**: Auto-compresses responses for text files (`.js`, `.css`, `.html`)
- **Zero Config**: Works out of the box for most use cases

## API Reference

### `useStatic(app, options)`

Registers static file serving on the app.

**Options:**

```typescript
interface StaticOptions {
  directory: string;              // Root directory to serve files from
  route?: string;                 // Route prefix (default: '/')
  cacheMaxAge?: number;           // Cache-Control max-age in seconds (default: 3600)
  etag?: boolean;                 // Generate ETags (default: true)
  gzip?: boolean;                 // Gzip compress text files (default: true)
  index?: string[];               // Index files for directories (default: ['index.html'])
}
```

## Examples

### Basic: Serve Public Assets

```typescript
useStatic(app, {
  directory: './public',
  route: '/assets',
});

// Requests:
// GET /assets/style.css     → ./public/style.css
// GET /assets/app.js        → ./public/app.js
// GET /assets/images/bg.png → ./public/images/bg.png
```

### With Custom Cache Headers

```typescript
useStatic(app, {
  directory: './dist',
  route: '/',
  cacheMaxAge: 86400 * 365, // Cache for 1 year
});

// Files are served with:
// Cache-Control: public, max-age=31536000
```

### Multiple Static Directories

```typescript
useStatic(app, { directory: './public', route: '/public' });
useStatic(app, { directory: './docs', route: '/docs' });

// GET /public/style.css  → ./public/style.css
// GET /docs/readme.html  → ./docs/readme.html
```

### SPA with Index Fallback

```typescript
useStatic(app, {
  directory: './dist',
  route: '/',
  index: ['index.html'], // Serve index.html for / and missing files
});

// GET /          → ./dist/index.html
// GET /page      → ./dist/index.html (SPA routing)
// GET /app.js    → ./dist/app.js
```

### Disable Gzip for Large Files

```typescript
useStatic(app, {
  directory: './public',
  gzip: false, // Don't compress (useful for pre-compressed assets)
});
```

## Security

### Path Traversal Protection

The static plugin automatically rejects dangerous paths:

```typescript
// ❌ These requests are rejected with 400:
GET /static/../../etc/passwd
GET /static/%2e%2e/sensitive.txt
GET /static/..%5cwindows%5csystem32
```

If you need to serve files with unusual names, ensure they don't contain path components.

### Directory-Only Access

Files are served **only** from the configured directory. Access to parent directories is impossible:

```typescript
useStatic(app, { directory: './public' });

// ❌ These requests return 404 (file not found), never bypass the directory:
GET /static/../../.env
GET /static/../../secrets.json
```

## Caching & ETags

### ETag Support

By default, files are served with `ETag` headers for cache validation:

```
GET /app.js
→ ETag: "abc123..."
→ Cache-Control: public, max-age=3600

# Browser makes same request later with If-None-Match
GET /app.js
If-None-Match: "abc123..."
→ 304 Not Modified (no body sent)
```

Disable ETags if serving extremely large files:

```typescript
useStatic(app, {
  directory: './large-files',
  etag: false, // Skip ETag generation
});
```

### Cache-Control Headers

Set how long browsers should cache files:

```typescript
// Assets that change rarely (versioned filenames)
useStatic(app, {
  directory: './dist',
  cacheMaxAge: 31536000, // 1 year
});

// Assets that change frequently
useStatic(app, {
  directory: './public',
  cacheMaxAge: 0, // No caching
});
```

## Gzip Compression

By default, text files are gzip-compressed for faster transfer:

```typescript
useStatic(app, {
  directory: './dist',
  gzip: true, // Compress .js, .css, .html, .svg, etc.
});

// Response:
// Content-Encoding: gzip
// Transfer-Encoding: chunked
// (much smaller than uncompressed)
```

Disable gzip for already-compressed assets (WebP, JPEG, AVIF):

```typescript
useStatic(app, {
  directory: './images',
  gzip: false, // Images are already compressed
});
```

## Directory Listings

The static plugin **does not** serve directory listings by default (for security):

```typescript
// GET /static/ → 404 Not Found
// (no directory listing)
```

If you need directory listing, implement it manually:

```typescript
app.route({
  method: 'GET',
  path: '/list/*',
  handler: async (req, res) => {
    const dir = req.params['*'];
    const files = await fs.promises.readdir(`./public/${dir}`);
    return res.send({ files });
  },
});
```

## Testing

```typescript
it('serves static files', async () => {
  const res = await fetch('http://localhost:3000/static/app.js');
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('javascript');
});

it('rejects path traversal attempts', async () => {
  const res = await fetch('http://localhost:3000/static/../../etc/passwd');
  expect(res.status).toBe(400); // Bad request
});

it('sends 304 Not Modified for cached files', async () => {
  // First request
  const res1 = await fetch('http://localhost:3000/static/app.js');
  const etag = res1.headers.get('ETag');
  
  // Second request with If-None-Match
  const res2 = await fetch('http://localhost:3000/static/app.js', {
    headers: { 'If-None-Match': etag },
  });
  expect(res2.status).toBe(304); // Not modified
});

it('compresses text files with gzip', async () => {
  const res = await fetch('http://localhost:3000/static/app.js', {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  expect(res.headers.get('Content-Encoding')).toBe('gzip');
});
```

## Performance Tips

1. **Use a CDN**: Serve static assets from a CDN (CloudFront, Cloudflare) for better geographic distribution.

2. **Version Your Assets**: Include hashes in filenames and set long cache times:
   ```
   /static/app.a1b2c3d4.js  (1 year cache)
   /static/app.e5f6g7h8.js  (new version, new cache)
   ```

3. **Separate Static & Dynamic**: Serve static files on a separate domain or port for isolation:
   ```typescript
   // Main API on :3000
   // Static files on :3001 or cdn.example.com
   ```

4. **Pre-Compress Assets**: For large projects, pre-compress files and disable gzip:
   ```typescript
   // Build step
   // gzip app.js → app.js.gz
   
   // Server
   useStatic(app, {
     directory: './dist',
     gzip: false, // Already compressed
   });
   ```

## MIME Types

Common MIME types are automatically detected. For custom types, add them in your app:

```typescript
// Before useStatic
app.route({
  method: 'GET',
  path: '/*',
  handler: async (req, res) => {
    if (req.path.endsWith('.webmanifest')) {
      res.header('Content-Type', 'application/manifest+json');
    }
    // Fallback to useStatic
  },
});

useStatic(app, { directory: './public' });
```

## Migration from v3.x

No breaking changes. If you were using a separate static file server, switch to `@axiomify/static`:

```typescript
// ❌ Before
express.static('./public');

// ✅ After
useStatic(app, { directory: './public' });
```

## License

MIT