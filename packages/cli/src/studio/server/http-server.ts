/**
 * Studio HTTP Server — serves the Studio SPA, API endpoints, and
 * WebSocket connections using Node's built-in `node:http` module.
 *
 * Key design decisions:
 * - Uses `node:http` (not uWS) because the native adapter is optional
 * - Embeds the SPA as inline HTML (Phase 1 placeholder; Phase 2+ serves
 *   pre-built static assets from `studio/client/dist/`)
 * - Default port 4399; falls back to a random available port if busy
 * - CORS headers allow any origin (Studio is a local dev tool)
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { URL } from 'node:url';
import { existsSync, promises as fsPromises } from 'node:fs';
import { join, extname } from 'node:path';
import { StudioRouter, type StudioRouteHandler } from './router';

export interface StudioServerOptions {
  /** Port to listen on. Falls back to random available port if busy. */
  port: number;
  /** The Studio API router with registered handlers. */
  router: StudioRouter;
  /** Callback invoked with the actual port and URL once the server is listening. */
  onReady?: (port: number, url: string) => void;
  /** Optional static fallback HTML. */
  indexHtml?: string;
  /** Optional security token to restrict API and WebSocket access. */
  token?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const FALLBACK_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Axiomify Studio</title>
</head>
<body>
  <div style="font-family: sans-serif; padding: 40px; text-align: center;">
    <h1>Axiomify Studio</h1>
    <p>Loading or build assets missing. Please run <code>npm run build</code> in the workspace.</p>
  </div>
</body>
</html>`;

/**
 * Helper to send a JSON response with standard headers.
 */
export function sendJson(
  res: ServerResponse,
  data: unknown,
  statusCode = 200,
): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/**
 * Helper to read the request body as a string.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Creates and starts the Studio HTTP server.
 *
 * If the requested port is busy, the server automatically falls back to
 * a random available port (port 0 tells the OS to pick one). The actual
 * port is reported via the `onReady` callback.
 */
export function createStudioServer(options: StudioServerOptions): Server {
  const { router } = options;

  // Resolve the ui-dist path dynamically
  const pathsToTry = [
    join(__dirname, '../ui-dist'),
    join(__dirname, '../../ui-dist'),
    join(__dirname, '../../../../ui-dist'),
  ];
  let uiDistPath = '';
  for (const p of pathsToTry) {
    if (existsSync(join(p, 'index.html'))) {
      uiDistPath = p;
      break;
    }
  }

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Parse the request URL.
      const parsedUrl = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? 'localhost'}`,
      );
      const pathname = parsedUrl.pathname;
      const method = (req.method ?? 'GET').toUpperCase();

      // ── CORS preflight ──────────────────────────────────────────────────
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      // ── Studio API routes ────────────────────────────────────────────────
      const handler = router.match(method, pathname);
      if (handler) {
        if (options.token) {
          const authHeader = req.headers['authorization'];
          const suppliedToken = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : '';
          // Fallback: accept token from query parameter (for browser navigations
          // like export downloads where no Authorization header is sent).
          const queryToken = suppliedToken || parsedUrl.searchParams.get('token') || '';
          if (queryToken !== options.token) {
            sendJson(
              res,
              {
                error: 'Unauthorized',
                message: 'Valid Access Token is required.',
              },
              401,
            );
            return;
          }
        }

        try {
          await handler(req, res);
        } catch (err) {
          if (!res.headersSent) {
            sendJson(
              res,
              { error: 'Internal Studio Error', message: String(err) },
              500,
            );
          }
        }
        return;
      }

      // ── Static assets serving ──────────────────────────────────────────
      if (uiDistPath) {
        const safePath = join(uiDistPath, pathname);
        if (safePath.startsWith(uiDistPath)) {
          let fileExists = false;
          let isFile = false;
          try {
            const stat = await fsPromises.stat(safePath);
            fileExists = true;
            isFile = stat.isFile();
          } catch {}

          if (fileExists && isFile) {
            const ext = extname(safePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            try {
              const data = await fsPromises.readFile(safePath);
              res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': data.length,
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(data);
              return;
            } catch (err) {
              res.writeHead(500);
              res.end(`Internal Server Error: ${String(err)}`);
              return;
            }
          }
        }
      }

      // ── SPA fallback — serve index.html for all non-API paths ───────────
      // This enables client-side routing in the SPA.
      let indexHtml = options.indexHtml || FALLBACK_HTML;
      if (!options.indexHtml && uiDistPath) {
        try {
          indexHtml = await fsPromises.readFile(join(uiDistPath, 'index.html'), 'utf8');
        } catch {}
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(indexHtml),
        'Cache-Control': 'no-store',
      });
      res.end(indexHtml);
    },
  );

  // Attempt to listen on the requested port; fall back to random if busy.
  listenWithFallback(server, options.port, options.onReady);

  return server;
}

/**
 * Tries to listen on `preferredPort`. If `EADDRINUSE`, retries on port 0
 * (OS-assigned random available port). The actual port is reported via
 * the `onReady` callback.
 */
function listenWithFallback(
  server: Server,
  preferredPort: number,
  onReady?: (port: number, url: string) => void,
): void {
  const startListening = (port: number, isRetry: boolean) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !isRetry) {
        // Port is busy — fall back to a random available port.
        startListening(0, true);
      } else {
        // Unrecoverable error — propagate.
        throw err;
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      onReady?.(actualPort, url);
    });
  };

  startListening(preferredPort, false);
}
