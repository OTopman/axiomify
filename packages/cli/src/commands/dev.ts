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
      // 1. Stop listening to old exit events so we don't accidentally spawn twice
      child.removeAllListeners('exit');

      // 2. ONLY spawn the new server after the old one has completely exited
      child.once('exit', () => {
        child = spawn('node', [outPath], { stdio: 'inherit' });
      });

      // 3. Ruthlessly kill the old server (bypasses graceful shutdown)
      child.kill('SIGKILL');
    } else {
      // First time booting up
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

  const userExternals = await getUserExternals(process.cwd());

  const ctx = await esbuild.context({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    outfile: outPath,
    external: [...new Set([...userExternals, 'node:*'])],
    plugins: [watchPlugin],
  });

  console.log(`👀 Axiomify Dev Engine watching for changes...`);
  await ctx.watch();
}
