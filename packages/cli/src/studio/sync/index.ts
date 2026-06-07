import type { Axiomify } from '@axiomify/core';
import * as esbuild from 'esbuild';
import path from 'node:path';
import pc from 'picocolors';
import { getUserExternals } from '../../utils/externals';
import { loadApp } from '../../utils/load-app';
import { computeImpacts, pendingImpacts } from '../api/sdk-impact';
import { performDiscovery, type StudioDiscoveryResult } from '../discovery';
import { StudioWsServer } from '../server/ws-server';

export interface SyncEngineOptions {
  entry: string;
  wsServer: StudioWsServer;
  initialExports?: any;
  onReload: (newDiscovery: StudioDiscoveryResult, newApp: Axiomify, exports: any) => void;
}

/**
 * The Studio Live Sync Engine.
 *
 * Uses esbuild's watch context to detect source file changes, recompiles the
 * app bundle, re-runs discovery, updates the memory cache, and broadcasts
 * reload/error signals to all connected browsers via WebSockets.
 */
export class StudioSyncEngine {
  private ctx: esbuild.BuildContext | null = null;
  private lastExports: any = null;

  constructor(private options: SyncEngineOptions) {
    this.lastExports = options.initialExports || null;
  }

  /**
   * Starts watching project files for changes.
   */
  public async start(): Promise<void> {
    const entryPath = path.resolve(process.cwd(), this.options.entry);
    const tempDir = path.resolve(process.cwd(), '.axiomify');
    const tempPath = path.join(tempDir, 'inspect.cjs');
    const userExternals = getUserExternals(process.cwd());

    const watchPlugin: esbuild.Plugin = {
      name: 'studio-watch-plugin',
      setup: (build) => {
        let first = true;
        build.onEnd(async (result) => {
          if (first) {
            first = false;
            return; // Skip first build because startStudio() performs it synchronously.
          }

          if (result.errors.length > 0) {
            console.error(
              pc.red('\n  ✗ Build failed. Fix errors to trigger reload.'),
            );
            this.options.wsServer.broadcast(
              JSON.stringify({ type: 'build-error', errors: result.errors }),
            );
            return;
          }

          console.log(pc.dim('  Changes detected, reloading app...'));

          try {
            // Close any closeable exports from the previous run
            if (this.lastExports) {
              for (const key of Object.keys(this.lastExports)) {
                try {
                  const val = this.lastExports[key];
                  if (val && typeof val.close === 'function') {
                    val.close();
                  } else if (val && typeof val.cleanup === 'function') {
                    await val.cleanup();
                  }
                } catch {
                  // ignore
                }
              }
            }

            // Clear CommonJS cache for the compiled app file.
            delete require.cache[require.resolve(tempPath)];

            // Reload the app and run discovery.
            const loaded = await loadApp(this.options.entry);
            this.lastExports = loaded.exports;
            const discovery = await performDiscovery(loaded.app);

            // Compute SDK changes/impacts
            const beforeCount = pendingImpacts.length;
            computeImpacts(discovery);
            const afterCount = pendingImpacts.length;

            // Update discovery cache in the router.
            this.options.onReload(discovery, loaded.app, loaded.exports);
            await loaded.cleanup();

            console.log(pc.green('  ✓ App reloaded successfully.'));

            // Broadcast refresh signal to the browser.
            this.options.wsServer.broadcast(JSON.stringify({ type: 'reload' }));

            if (afterCount > beforeCount) {
              this.options.wsServer.broadcast(
                JSON.stringify({
                  type: 'sdk-impact',
                  count: pendingImpacts.length,
                }),
              );
            }
          } catch (err) {
            console.error(pc.red('  ✗ Reload failed:'), (err as Error).message);
            this.options.wsServer.broadcast(
              JSON.stringify({
                type: 'reload-error',
                message: (err as Error).message,
              }),
            );
          }
        });
      },
    };

    this.ctx = await esbuild.context({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: tempPath,
      external: [...new Set([...userExternals, 'node:*'])],
      plugins: [watchPlugin],
      logLevel: 'silent',
    });

    await this.ctx.watch();
  }

  /**
   * Disposes of the file watcher context.
   */
  public async stop(): Promise<void> {
    if (this.ctx) {
      await this.ctx.dispose();
      this.ctx = null;
    }
  }
}
