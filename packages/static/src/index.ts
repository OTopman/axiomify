import type { Axiomify } from '@axiomify/core';
import * as fs from 'fs';
import * as path from 'path';

export interface StaticOptions {
  prefix: string; // e.g., '/public'
  root: string; // Absolute path to the folder, e.g., path.join(__dirname, 'public')
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

export function serveStatic(app: Axiomify, options: StaticOptions): void {
  // Ensure the prefix starts with a slash and doesn't end with one
  const prefix = options.prefix.startsWith('/')
    ? options.prefix
    : `/${options.prefix}`;
  const routePath = prefix === '/' ? '/*' : `${prefix}/*`;

  // Resolve the root once up-front so the containment check is cheap per-request.
  const rootResolved = path.resolve(options.root);

  app.route({
    method: 'GET',
    path: routePath,
    handler: async (req, res) => {
      try {
        // Extract the requested file path from the wildcard parameter
        const reqPath = (req.params as any)['*'] || '';

        // First pass: normalize and strip a leading "../" run. This keeps the
        // behaviour documented in the existing tests (traversal attempts
        // resolve to a missing path inside root rather than 403).
        const safeSuffix = path
          .normalize(reqPath)
          .replace(/^(\.\.[\/\\])+/, '');
        const absolutePath = path.resolve(rootResolved, safeSuffix);

        // Second pass (defense in depth): after resolving, the final path MUST
        // be inside rootResolved. Covers Windows-style '..\..\' inputs, mixed
        // separators, and anything the regex missed.
        if (
          absolutePath !== rootResolved &&
          !absolutePath.startsWith(rootResolved + path.sep)
        ) {
          return res.status(403).send(null, 'Forbidden');
        }

        // Check if file exists and is not a directory
        const stat = await fs.promises.stat(absolutePath);
        if (!stat.isFile()) {
          return res.status(404).send(null, 'File not found');
        }

        // Generate ETag from file size and modified time
        const etag = `W/"${stat.size.toString(16)}-${stat.mtime
          .getTime()
          .toString(16)}"`;
        res.header('ETag', etag);

        // Check If-None-Match for 304 Not Modified. Per RFC 7232, a 304
        // response must not include a message body or Content-Type — only
        // validators. `sendRaw('')` would still set Content-Type, so poke
        // res.raw directly for a clean 304.
        if (req.headers['if-none-match'] === etag) {
          const rawRes = (res as any).raw;
          if (rawRes && typeof rawRes.writeHead === 'function') {
            rawRes.writeHead(304, { ETag: etag });
            rawRes.end();
            return;
          }
          // Fallback if the raw response isn't a Node ServerResponse shape.
          return res.status(304).sendRaw('');
        }

        // Determine MIME type
        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // Add caching headers
        res.header('Cache-Control', 'public, max-age=86400');
        res.header('Content-Length', String(stat.size));

        // Use the native streaming API we built in P1
        const stream = fs.createReadStream(absolutePath);
        res.stream(stream, contentType);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          res.status(404).send(null, 'File not found');
        } else {
          res.status(500).send(null, 'Internal Server Error');
        }
      }
    },
  });
}
