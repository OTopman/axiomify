import * as esbuild from 'esbuild';
import path from 'path';

export async function buildProject(entry: string): Promise<void> {
  const entryPath = path.resolve(process.cwd(), entry);
  const outPath = path.resolve(process.cwd(), 'dist/index.js');

  console.log(`🔨 Building production bundle from ${entry}...`);

  try {
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: outPath,
      minify: true,
      keepNames: true, // Important for preserving class names in logs
      external: [
        'express',
        '@axiomify/core',
        '@axiomify/express',
        // In a real monorepo, these might be bundled or kept external based on preference.
        // For Node.js backends, keeping node_modules external is standard practice.
      ],
    });

    console.log(`✅ Build successful: ${outPath}`);
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}
