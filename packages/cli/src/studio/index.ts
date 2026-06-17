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
import type { Axiomify } from '@axiomify/core';
import { randomBytes } from 'node:crypto';
import { type Server } from 'node:http';
import pc from 'picocolors';
import { loadApp } from '../utils/load-app';
import { registerStudioApi } from './api';
import { getContractsAutoRun, runAllContractTests, setOnContractsUpdated } from './api/contracts';
import { instrumentErrorObservatory } from './api/errors';
import { instrumentLogs, setOnLogsUpdated } from './api/logs';
import { setOnPerfUpdated } from './api/perf';
import { setOnRecorderUpdated } from './api/recorder';
import { instrumentRequestReplay, setOnReplayUpdated } from './api/replay';
import { setBaselineDiscovery } from './api/sdk-impact';
import { instrumentTrafficProfiling } from './api/traffic-interceptor';
import { instrumentWsAnalytics, stopWsMetricsInterval, clearRoomManagers } from './api/ws-analytics';
import { setOnTracesUpdated } from './api/otlp';
import { performDiscovery, type StudioDiscoveryResult } from './discovery';
import { createStudioServer } from './server/http-server';
import { StudioRouter } from './server/router';
import { StudioWsServer } from './server/ws-server';
import { StudioSyncEngine } from './sync';

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
  const studioToken = randomBytes(16).toString('hex');

  // Set environment variables for native OpenTelemetry auto-export to discover Studio
  process.env.AXIOMIFY_STUDIO = 'true';
  process.env.AXIOMIFY_STUDIO_PORT = String(port);
  process.env.AXIOMIFY_STUDIO_TOKEN = studioToken;

  // ── 1. Load the user's app ────────────────────────────────────────────
  console.log();
  console.log(pc.bold('  🎨 Axiomify Studio'));
  console.log();
  console.log(pc.dim('  Loading application...'));

  // Pre-instrument WS/Socket.io prototypes before loading the app bundle
  instrumentWsAnalytics();

  let app: Axiomify;
  let cleanup: () => Promise<void>;
  let loadedExports: Record<string, any> = {};
  try {
    const loaded = await loadApp(entry);
    app = loaded.app;
    cleanup = loaded.cleanup;
    loadedExports = loaded.exports;
    instrumentErrorObservatory(app);
    // Scan module exports for RoomManager instances after app loading
    instrumentWsAnalytics(app, loaded.exports);
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

  // Set baseline discovery for SDK impact tracking
  setBaselineDiscovery(discovery);

  // ── 3. Set up the router, WebSocket server and API ───────────────────
  let currentApp = app;
  const router = new StudioRouter();
  const wsServer = new StudioWsServer();

  // Set up the replay update notification to broadcast to WS clients
  setOnReplayUpdated(() => {
    wsServer.broadcast(JSON.stringify({ type: 'replays-updated' }));
  });

  // Set up the logs update notification to broadcast to WS clients
  setOnLogsUpdated(() => {
    wsServer.broadcast(JSON.stringify({ type: 'logs-updated' }));
  });

  // Set up recorder & perf WS notifications
  setOnRecorderUpdated(() => {
    wsServer.broadcast(JSON.stringify({ type: 'recorder-updated' }));
  });

  setOnPerfUpdated(() => {
    wsServer.broadcast(JSON.stringify({ type: 'perf-updated' }));
  });

  setOnContractsUpdated(() => {
    wsServer.broadcast(JSON.stringify({ type: 'contracts-updated' }));
  });

  // Set up OpenTelemetry traces WS notification
  setOnTracesUpdated(() => {
    wsServer.broadcast(JSON.stringify({ type: 'traces-updated' }));
  });

  // Instrument initial app load, console logs, and traffic profiling
  instrumentRequestReplay(currentApp);
  instrumentLogs();
  instrumentTrafficProfiling(currentApp);

  registerStudioApi(router, {
    getDiscovery: () => discovery,
    getApp: () => currentApp,
  });

  // ── 4. Boot the HTTP server ──────────────────────────────────────────
  let server: Server;

  try {
    server = createStudioServer({
      port,
      router,
      token: studioToken,
      onReady: (actualPort, url) => {
        process.env.AXIOMIFY_STUDIO_PORT = String(actualPort);
        const urlWithToken = `${url}/?token=${studioToken}`;
        console.log();
        console.log(
          `  ${pc.green('✓')} Studio is live at ${pc.cyan(pc.bold(urlWithToken))}`,
        );
        console.log(`    Access Token: ${pc.yellow(studioToken)}`);
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
          openBrowser(urlWithToken).catch(() => {
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
        const tokenParam = parsedUrl.searchParams.get('token');
        if (tokenParam !== studioToken) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
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
    initialExports: loadedExports,
    onReload: (newDiscovery, newApp, newExports) => {
      // Clear old WS RoomManager cache instances
      clearRoomManagers();

      discovery = newDiscovery;
      currentApp = newApp;
      instrumentErrorObservatory(newApp);
      // Re-instrument WS analytics with new exports
      instrumentWsAnalytics(newApp, newExports);
      instrumentRequestReplay(newApp);
      instrumentTrafficProfiling(newApp);
      
      if (getContractsAutoRun()) {
        runAllContractTests(newDiscovery, newApp).catch(() => {});
      }
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

    stopWsMetricsInterval();
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
 * Uses platform-specific commands with execFile (args array) to avoid
 * shell command injection. Non-fatal if it fails.
 */
async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const platform = process.platform;

  let cmd: string;
  let args: string[];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve) => {
    execFile(cmd, args, () => {
      // Silently resolve — failing to open the browser is non-fatal.
      resolve();
    });
  });
}
