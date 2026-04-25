import type { Axiomify } from '@axiomify/core';
import * as fs from 'fs';
import * as path from 'path';

export interface StaticOptions {
  prefix: string;
  root: string;
  /**
   * Force download (Content-Disposition: attachment) instead of inline
   * rendering for these extensions. Defaults to forcing download for SVG
   * and HTML files, which can execute JavaScript when rendered inline by
   * a browser.
   */
  forceDownloadExtensions?: string[];
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

const DEFAULT_FORCE_DOWNLOAD = new Set(['.svg', '.html', '.htm', '.xml']);

export function serveStatic(app: Axiomify, options: StaticOptions): void {
  const prefix = options.prefix.startsWith('/')
    ? options.prefix
    : `/${options.prefix}`;
  const routePath = prefix === '/' ? '/*' : `${prefix}/*`;

  const rootResolved = path.resolve(options.root);
  const forceDownload = options.forceDownloadExtensions
    ? new Set(options.forceDownloadExtensions.map((e) => e.toLowerCase()))
    : DEFAULT_FORCE_DOWNLOAD;

  app.route({
    method: 'GET',
    path: routePath,
    handler: async (req, res) => {
      try {
        const reqPath = (req.params as any)['*'] || '';
        const safeSuffix = path
          .normalize(reqPath)
          .replace(/^(\.\.[\\/\\])+/, '');
        const absolutePath = path.resolve(rootResolved, safeSuffix);

        if (
          absolutePath !== rootResolved &&
          !absolutePath.startsWith(rootResolved + path.sep)
        ) {
          return res.status(403).send(null, 'Forbidden');
        }

        const stat = await fs.promises.stat(absolutePath);
        if (!stat.isFile()) {
          return res.status(404).send(null, 'File not found');
        }

        const etag = `W/"${stat.size.toString(16)}-${stat.mtime
          .getTime()
          .toString(16)}"`;
        res.header('ETag', etag);

        if (req.headers['if-none-match'] === etag) {
          const rawRes = (res as any).raw;
          if (rawRes && typeof rawRes.writeHead === 'function') {
            rawRes.writeHead(304, { ETag: etag });
            rawRes.end();
            return;
          }
          return res.status(304).sendRaw('');
        }

        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.header('Cache-Control', 'public, max-age=86400');
        res.header('Content-Length', String(stat.size));

        // Force download for executable content types. SVG and HTML served
        // inline can execute JavaScript via <script> tags or event handlers.
        // attachment + nosniff prevents browsers from rendering them.
        if (forceDownload.has(ext)) {
          const filename = path.basename(absolutePath);
          res.header(
            'Content-Disposition',
            `attachment; filename="${filename.replace(/"/g, '\\"')}"`,
          );
          res.header('X-Content-Type-Options', 'nosniff');
        }

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
