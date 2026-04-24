import { ChildProcess, spawn } from 'child_process';
import * as esbuild from 'esbuild';
import path from 'path';
import { getUserExternals } from '../utils/externals';

export async function devServer(entry: string): Promise<void> {
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

  const restartServer = () => {
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
  };

  const watchPlugin: esbuild.Plugin = {
    name: 'watch-plugin',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) {
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
