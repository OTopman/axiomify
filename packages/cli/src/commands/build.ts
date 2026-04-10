import * as esbuild from 'esbuild';
import path from 'path';
import { getUserExternals } from '../utils/externals';

export async function buildProject(entry: string): Promise<void> {
  const entryPath = path.resolve(process.cwd(), entry);
  const outPath = path.resolve(process.cwd(), 'dist/index.js');

  const userExternals = getUserExternals(process.cwd());

  console.log(`🔨 Building production bundle from ${entry}...`);

  try {
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: outPath,
      minify: true,
      keepNames: true,
      external: [...new Set([...userExternals, 'node:*'])],
    });

    console.log(`✅ Build successful: ${outPath}`);
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}
