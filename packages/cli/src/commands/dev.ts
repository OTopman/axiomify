import { ChildProcess, spawn } from 'child_process';
import * as esbuild from 'esbuild';
import path from 'path';
import { getUserExternals } from '../utils/externals';

export async function devServer(entry: string): Promise<void> {
  const entryPath = path.resolve(process.cwd(), entry);
  const outPath = path.resolve(process.cwd(), '.axiomify/dev.js');
  let child: ChildProcess | null = null;

  const restartServer = () => {
    if (child) {
      child.removeAllListeners('exit');
      child.once('exit', () => {
        child = spawn('node', [outPath], { stdio: 'inherit' });
      });
      child.kill('SIGKILL');
    } else {
      child = spawn('node', [outPath], { stdio: 'inherit' });
    }
  };

  const watchPlugin: esbuild.Plugin = {
    name: 'watch-plugin',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error('❌ Build failed. Waiting for changes...');
        } else {
          restartServer();
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

  // On Ctrl-C / SIGTERM, tear everything down. Without this the spawned
  // server child survives after the CLI exits — a classic "why is port
  // 3000 still in use?" leak.
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n👋 Received ${signal}, shutting down dev server...`);

    if (child) {
      child.removeAllListeners('exit');
      child.kill('SIGTERM');
      // Give it 2s to exit gracefully, then SIGKILL.
      setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL');
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
