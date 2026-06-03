/**
 * Axiomify Studio — public entry point.
 *
 * Orchestrates the Studio startup sequence:
 *   1. Load the user's Axiomify app via `loadApp()`
 *   2. Run discovery to extract metadata
 *   3. Register API routes
 *   4. Boot the HTTP server
 *   5. Open the browser
 *
 * This module is the interface between the CLI command and the Studio
 * subsystem. Everything Studio-related flows through `startStudio()`.
 */
import { type Server } from 'node:http';
import pc from 'picocolors';
import { loadApp } from '../utils/load-app';
import { performDiscovery, type StudioDiscoveryResult } from './discovery';
import { StudioRouter } from './server/router';
import { createStudioServer } from './server/http-server';
import { registerStudioApi } from './api';
import { buildIndexHtml } from './client/index-html';
import { StudioWsServer } from './server/ws-server';
import { StudioSyncEngine } from './sync';
import { instrumentErrorObservatory } from './api/errors';
import { instrumentWsAnalytics } from './api/ws-analytics';

export interface StudioOptions {
  /** Port to listen on. Default: 4399. */
  port?: number;
  /** Whether to auto-open the browser. Default: true. */
  open?: boolean;
}

const DEFAULT_PORT = 4399;

export async function startStudio(
  entry: string,
  options: StudioOptions = {},
): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const autoOpen = options.open !== false;

  // ── 1. Load the user's app ────────────────────────────────────────────
  console.log();
  console.log(pc.bold('  🎨 Axiomify Studio'));
  console.log();
  console.log(pc.dim('  Loading application...'));

  let app: any;
  let cleanup: () => Promise<void>;
  try {
    const loaded = await loadApp(entry);
    app = loaded.app;
    cleanup = loaded.cleanup;
    instrumentErrorObservatory(app);
    instrumentWsAnalytics();
  } catch (err) {
    console.error(pc.red('  ✗ Failed to load app:'));
    console.error('   ', (err as Error).message);
    process.exit(1);
  }

  // ── 2. Run discovery ─────────────────────────────────────────────────
  console.log(pc.dim('  Running discovery...'));

  let discovery: StudioDiscoveryResult;
  try {
    discovery = await performDiscovery(app);
  } catch (err) {
    console.error(pc.red('  ✗ Discovery failed:'));
    console.error('   ', (err as Error).message);
    await cleanup!();
    process.exit(1);
  }

  const routeCount =
    discovery.config.httpRouteCount + discovery.config.wsRouteCount;
  console.log(
    pc.dim(
      `  Discovered ${routeCount} route${routeCount === 1 ? '' : 's'}, ` +
        `${discovery.schemas.length} schema${discovery.schemas.length === 1 ? '' : 's'}, ` +
        `${discovery.config.hookCount} hook${discovery.config.hookCount === 1 ? '' : 's'}`,
    ),
  );

  // ── 3. Set up the router, WebSocket server and API ───────────────────
  let currentApp = app;
  const router = new StudioRouter();
  const wsServer = new StudioWsServer();
  registerStudioApi(router, {
    getDiscovery: () => discovery,
    getApp: () => currentApp,
  });

  // ── 4. Boot the HTTP server ──────────────────────────────────────────
  const indexHtml = buildIndexHtml();
  let server: Server;

  try {
    server = createStudioServer({
      port,
      router,
      indexHtml,
      onReady: (actualPort, url) => {
        console.log();
        console.log(
          `  ${pc.green('✓')} Studio is live at ${pc.cyan(pc.bold(url))}`,
        );
        if (actualPort !== port) {
          console.log(
            pc.dim(
              `    Port ${port} was busy — using random port ${actualPort}`,
            ),
          );
        }
        console.log();
        console.log(pc.dim('  Press Ctrl+C to stop'));
        console.log();

        // Auto-open browser.
        if (autoOpen) {
          openBrowser(url).catch(() => {
            // Non-fatal — user can open manually.
          });
        }
      },
    });

    // Handle WebSocket upgrades.
    server.on('upgrade', (req, socket) => {
      const parsedUrl = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? 'localhost'}`,
      );
      if (parsedUrl.pathname === '/__studio/ws') {
        wsServer.handleUpgrade(req, socket);
      } else {
        socket.destroy();
      }
    });
  } catch (err) {
    console.error(pc.red('  ✗ Failed to start Studio server:'));
    console.error('   ', (err as Error).message);
    wsServer.close();
    await cleanup!();
    process.exit(1);
  }

  // ── 5. Start the Live Sync Engine ────────────────────────────────────
  const syncEngine = new StudioSyncEngine({
    entry,
    wsServer,
    onReload: (newDiscovery, newApp) => {
      discovery = newDiscovery;
      currentApp = newApp;
      instrumentErrorObservatory(newApp);
      instrumentWsAnalytics();
    },
  });

  try {
    await syncEngine.start();
  } catch (err) {
    console.warn(
      pc.yellow(`  ⚠ Live sync failed to start: ${(err as Error).message}`),
    );
  }

  // ── 6. Graceful shutdown ─────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${pc.dim(`Received ${signal}, shutting down Studio...`)}`);

    await syncEngine.stop();
    wsServer.close();
    server!.close();
    await cleanup!();

    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Opens a URL in the user's default browser.
 * Uses platform-specific commands; non-fatal if it fails.
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const platform = process.platform;

  const command =
    platform === 'darwin'
      ? `open "${url}"`
      : platform === 'win32'
        ? `start "${url}"`
        : `xdg-open "${url}"`;

  return new Promise((resolve) => {
    exec(command, (err) => {
      // Silently resolve — failing to open the browser is non-fatal.
      resolve();
    });
  });
}
