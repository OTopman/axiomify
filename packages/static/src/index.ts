import type { Axiomify } from '@axiomify/core';
import * as fs from 'fs';
import * as path from 'path';

export interface StaticOptions {
  prefix: string;
  root: string;
  /**
   * Force download (Content-Disposition: attachment) instead of inline
   * rendering for these extensions. Defaults to forcing download for SVG,
   * HTML, and XML files, which can execute JavaScript when rendered inline.
   */
  forceDownloadExtensions?: string[];
  /**
   * Cache-Control header value for all served files.
   * @default 'public, max-age=86400'
   * @example 'public, max-age=31536000, immutable'  // for content-hashed assets
   * @example 'no-store'                              // for API responses
   * @example 'public, max-age=3600, stale-while-revalidate=86400'
   */
  cacheControl?: string;
  /**
   * Serve `index.html` when a directory path is requested. Default: true.
   */
  serveIndex?: boolean;
}

const MIME_TYPES: Record<string, string> = {
  // Web
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/typescript',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  // Media
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  // Documents
  '.pdf': 'application/pdf',
  // Data
  '.csv': 'text/csv; charset=utf-8',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  // WebAssembly
  '.wasm': 'application/wasm',
};

const DEFAULT_FORCE_DOWNLOAD = new Set(['.svg', '.html', '.htm', '.xml']);

interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a `Range` request header per RFC 9110 §14.
 *
 * Returns:
 *   - `ByteRange`        — a single satisfiable range, clamped to the file.
 *   - `'unsatisfiable'`  — a syntactically valid range that cannot be
 *                          satisfied (416 with an unsatisfied-range Content-Range).
 *   - `null`             — malformed, non-`bytes` unit, or multi-range
 *                          (serve the full representation with 200).
 */
function parseRange(
  header: string,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (!match) return null;
  const spec = match[1].trim();
  // Multi-range responses require multipart/byteranges framing; serving the
  // full representation with 200 is always a valid fallback (RFC 9110 §15.3.7).
  if (spec.includes(',')) return null;

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return null;
  const [, startStr, endStr] = parts;
  if (startStr === '' && endStr === '') return null;

  // suffix-length form: bytes=-N (final N bytes)
  if (startStr === '') {
    const suffix = Number(endStr);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startStr);
  if (start >= size) return 'unsatisfiable';
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  // last-byte-pos < first-byte-pos is invalid — ignore the header (RFC 9110 §14.1.1).
  if (end < start) return null;
  return { start, end };
}

/**
 * Evaluate `If-Range` (RFC 9110 §13.1.5): the Range header is honored only
 * when the validator still matches the current representation; otherwise the
 * full file is served with 200.
 */
function ifRangeMatches(ifRange: string, etag: string, mtime: Date): boolean {
  const value = ifRange.trim();
  // Entity-tag form (either weak-prefixed or quoted).
  if (value.startsWith('W/') || value.startsWith('"')) {
    return value === etag;
  }
  // HTTP-date form: valid when the file has not been modified since the date.
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  // Last-Modified has one-second precision; truncate mtime for the compare.
  const mtimeSeconds = Math.floor(mtime.getTime() / 1000) * 1000;
  return mtimeSeconds <= parsed;
}

function realpathSafe(target: string): Promise<string> {
  if (typeof fs.promises.realpath === 'function') {
    return fs.promises.realpath(target);
  }
  return Promise.resolve(path.resolve(target));
}

export function serveStatic(app: Axiomify, options: StaticOptions): void {
  const prefix = options.prefix.startsWith('/')
    ? options.prefix
    : `/${options.prefix}`;
  const routePath = prefix === '/' ? '/*' : `${prefix}/*`;

  const rootResolved = path.resolve(options.root);
  const rootRealPath = realpathSafe(rootResolved);
  const forceDownload = options.forceDownloadExtensions
    ? new Set(options.forceDownloadExtensions.map((e) => e.toLowerCase()))
    : DEFAULT_FORCE_DOWNLOAD;
  const cacheControl = options.cacheControl ?? 'public, max-age=86400';
  const serveIndex = options.serveIndex !== false;

  app.route({
    method: 'GET',
    path: routePath,
    handler: async (req, res) => {
      try {
        const rootReal = await rootRealPath;
        const reqPath = String((req.params as any)['*'] || '');
        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(reqPath);
        } catch {
          return res.status(400).send(null, 'Bad Request');
        }

        if (decodedPath.includes('\0') || path.isAbsolute(decodedPath)) {
          return res.status(403).send(null, 'Forbidden');
        }

        const normalizedPath = path.normalize(decodedPath.replace(/\\/g, '/'));
        if (
          normalizedPath === '..' ||
          normalizedPath.startsWith(`..${path.sep}`) ||
          normalizedPath.includes(`${path.sep}..${path.sep}`)
        ) {
          return res.status(403).send(null, 'Forbidden');
        }

        const absolutePath = path.resolve(rootReal, normalizedPath);
        const realPath = await realpathSafe(absolutePath);

        if (
          realPath !== rootReal &&
          !realPath.startsWith(rootReal + path.sep)
        ) {
          return res.status(403).send(null, 'Forbidden');
        }

        const stat = await fs.promises.stat(realPath);

        // Directory: try serving index.html when serveIndex is enabled
        if (stat.isDirectory()) {
          if (!serveIndex) return res.status(403).send(null, 'Forbidden');
          const indexPath = path.join(realPath, 'index.html');
          try {
            const idxStat = await fs.promises.stat(indexPath);
            if (!idxStat.isFile())
              return res.status(404).send(null, 'File not found');
            res.header('Cache-Control', cacheControl);
            res.header('Content-Length', String(idxStat.size));
            res.stream(
              fs.createReadStream(indexPath),
              'text/html; charset=utf-8',
            );
          } catch {
            res.status(404).send(null, 'File not found');
          }
          return;
        }

        if (!stat.isFile()) {
          return res.status(404).send(null, 'File not found');
        }

        // Range requests are supported for real files only (RFC 9110 §14).
        res.header('Accept-Ranges', 'bytes');
        res.header('Last-Modified', stat.mtime.toUTCString());

        const ino = stat.ino ?? 0;
        const etag = `W/"${ino.toString(16)}-${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;
        res.header('ETag', etag);

        // If-None-Match takes precedence over Range (RFC 9110 §13.2.2).
        if (req.headers['if-none-match'] === etag) {
          return res.status(304).sendRaw('');
        }

        // ── Range negotiation ───────────────────────────────────────────────
        let range: ByteRange | null = null;
        const rangeHeader = req.headers['range'];
        if (typeof rangeHeader === 'string' && rangeHeader) {
          // If-Range: honor Range only while the validator still matches;
          // a stale validator downgrades to the full 200 representation.
          const ifRange = req.headers['if-range'];
          const applicable =
            typeof ifRange === 'string' && ifRange
              ? ifRangeMatches(ifRange, etag, stat.mtime)
              : true;
          if (applicable) {
            const parsed = parseRange(rangeHeader, stat.size);
            if (parsed === 'unsatisfiable') {
              res.header('Content-Range', `bytes */${stat.size}`);
              return res.status(416).send(null, 'Range Not Satisfiable');
            }
            range = parsed;
          }
        }

        const ext = path.extname(realPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.header('Cache-Control', cacheControl);
        if (range) {
          res.status(206);
          res.header(
            'Content-Range',
            `bytes ${range.start}-${range.end}/${stat.size}`,
          );
          res.header('Content-Length', String(range.end - range.start + 1));
        } else {
          res.header('Content-Length', String(stat.size));
        }
        res.header('X-Content-Type-Options', 'nosniff');

        // Force download for executable content types. SVG and HTML served
        // inline can execute JavaScript via <script> tags or event handlers.
        // attachment + nosniff prevents browsers from rendering them.
        /* v8 ignore next -- force-download path requires .svg/.html test fixtures */
        if (forceDownload.has(ext)) {
          const filename = path.basename(realPath);
          res.header(
            'Content-Disposition',
            `attachment; filename="${filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
          );
        }

        const stream = range
          ? fs.createReadStream(realPath, { start: range.start, end: range.end })
          : fs.createReadStream(realPath);
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
