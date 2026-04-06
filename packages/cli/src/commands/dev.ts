import { ChildProcess, spawn } from 'child_process';
import * as esbuild from 'esbuild';
import path from 'path';

export async function devServer(entry: string): Promise<void> {
  const entryPath = path.resolve(process.cwd(), entry);
  const outPath = path.resolve(process.cwd(), '.axiomify/dev.js');
  let nodeProcess: ChildProcess | null = null;

  const restartServer = () => {
    if (nodeProcess) nodeProcess.kill();

    console.log(`\n🔄 Restarting server...`);
    nodeProcess = spawn('node', [outPath], { stdio: 'inherit' });
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

  const ctx = await esbuild.context({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    outfile: outPath,
    external: [
      'express',
      '@axiomify/core',
      '@axiomify/express',
      '@axiomify/logger',
      'maskify-ts',
    ],
    plugins: [watchPlugin],
  });

  console.log(`👀 Axiomify Dev Engine watching for changes...`);
  await ctx.watch();
}
