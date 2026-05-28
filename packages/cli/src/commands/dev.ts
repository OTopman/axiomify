import { ChildProcess, spawn } from 'child_process';
import * as esbuild from 'esbuild';
import path from 'path';
import { getUserExternals } from '../utils/externals';
import { generateSdk } from './sdk/generate';

export interface DevOptions {
  watchSdk?: string[];
}

export async function devServer(entry: string, options: DevOptions = {}): Promise<void> {
  const entryPath = path.resolve(process.cwd(), entry);
  const outPath = path.resolve(process.cwd(), '.axiomify/dev.js');

  let child: ChildProcess | null = null;
  let firstBuild = true;

  const startChild = () => {
    child = spawn('node', [outPath], { stdio: 'inherit' });

    child.on('error', (err) => {
      console.error('❌ Failed to start process:', err);
    });
  };

  const GRACEFUL_KILL_MS = 3000;

  const restartServer = () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.removeAllListeners('exit');
      const oldChild = child;

      // Try graceful shutdown first so in-flight requests can drain and
      // SIGTERM handlers in the user's app can run cleanly.
      oldChild.once('exit', () => {
        startChild();
      });

      oldChild.kill('SIGTERM');

      // Hard kill only if the child doesn't exit within the grace window.
      const forceKill = setTimeout(() => {
        if (oldChild.exitCode === null && oldChild.signalCode === null) {
          oldChild.kill('SIGKILL');
        }
      }, GRACEFUL_KILL_MS);
      forceKill.unref();
    } else {
      startChild();
    }
  };

  /*   const restartServer = () => {
    // Check if the process is actually still running at the OS level
    if (child && child.exitCode === null && child.signalCode === null) {
      child.removeAllListeners('exit');
      child.once('exit', () => {
        startChild();
      });

      child.kill('SIGKILL');
    } else {
      startChild();
    }
  }; */

  const watchPlugin: esbuild.Plugin = {
    name: 'watch-plugin',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) {
          if (options.watchSdk && options.watchSdk.length > 0) {
            console.log('\n🔄 Automatically regenerating SDKs...');
            // Fire-and-forget generation using the original entry path.
            // exitOnError: false ensures a schema syntax error doesn't kill the dev server.
            generateSdk({
              input: entryPath,
              target: options.watchSdk,
              output: 'generated-sdks',
              exitOnError: false
            }).catch(e => {
              console.error('❌ SDK Generation threw an unexpected error:', e);
            });
          }

          if (firstBuild) {
            firstBuild = false;
            restartServer();
          } else {
            console.log('🔄 Changes detected, restarting...');
            restartServer();
          }
        } else {
          console.error('❌ Build failed. Fix errors to trigger a restart.');
        }
      });
    },
  };

  const userExternals = getUserExternals(process.cwd());

  const ctx = await esbuild.context({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: outPath,
    external: [...new Set([...userExternals, 'node:*'])],
    plugins: [watchPlugin],
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n👋 Received ${signal}, shutting down dev server...`);

    if (child) {
      child.removeAllListeners('exit');
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child && child.exitCode === null) child.kill('SIGKILL');
      }, 2000).unref();
    }

    try {
      await ctx.dispose();
    } catch {
      // ignore cleanup errors
    }

    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`👀 Axiomify Dev Engine watching for changes...`);
  await ctx.watch();
}
