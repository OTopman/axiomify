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

  app.route({
    method: 'GET',
    path: routePath,
    handler: async (req, res) => {
      try {
        // Extract the requested file path from the wildcard parameter
        const reqPath = (req.params as any)['*'] || '';

        // Secure the path to prevent directory traversal attacks (e.g., ../../etc/passwd)
        const safeSuffix = path
          .normalize(reqPath)
          .replace(/^(\.\.[\/\\])+/, '');
        const absolutePath = path.join(options.root, safeSuffix);

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

        // Check If-None-Match for 304 Not Modified
        if (req.headers['if-none-match'] === etag) {
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
